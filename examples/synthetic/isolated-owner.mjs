// Experimental fixed-code, nonproduction owner *process* boundary.
// No arbitrary path/plugin execution, network target, user payload or secrets.
// This is NOT an OS sandbox: the child retains the runner's FS/user privileges.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const childPath = fileURLToPath(new URL('./isolated-owner-child.mjs', import.meta.url));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const modes = new Set(['ok', 'degraded', 'hang', 'crash', 'oversize', 'late']);
const unavailable = () => new Error('isolated fixture unavailable');

function fields(value, expected) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length || !expected.every(key => keys.includes(key))) return null;
    const d = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of expected) {
      if (!d[key] || !own(d[key], 'value')) return null;
      result[key] = d[key].value;
    }
    return result;
  } catch { return null; }
}

const outputPattern = /^\{"state":"(ok|degraded)","observed_at":"([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z)"\}\n$/;

export function createIsolatedSyntheticOwner(options) {
  const c = fields(options, ['mode', 'permit', 'deadlineMs', 'maxConcurrent']);
  if (!c || !modes.has(c.mode) || typeof c.permit !== 'function' ||
      !Number.isInteger(c.deadlineMs) || c.deadlineMs < 20 || c.deadlineMs > 1000 ||
      !Number.isInteger(c.maxConcurrent) || c.maxConcurrent < 1 || c.maxConcurrent > 4) {
    throw new TypeError('invalid isolated fixture configuration');
  }
  const mode = c.mode;
  const permit = c.permit;
  const deadlineMs = c.deadlineMs;
  const maxConcurrent = c.maxConcurrent;
  let active = 0;

  return Object.freeze({
    async authorize(actor, capability, { signal } = {}) {
      try {
        if (signal?.aborted) return false;
        const allowed = (await permit(actor, capability, { signal })) === true;
        return allowed && !signal?.aborted;
      } catch { return false; }
    },
    activeCount() { return active; },
    async readStatus({ signal } = {}) {
      try {
        if (!(signal instanceof AbortSignal) || signal.aborted || active >= maxConcurrent) {
          throw unavailable();
        }
      } catch {
        throw unavailable();
      }
      // One child = one read; admission is held until actual child CLOSE,
      // even if the caller times out or aborts first.
      active += 1;
      return new Promise((resolve, reject) => {
        let child;
        let timer;
        let finished = false;
        let released = false;
        let output = '';
        let size = 0;
        const release = () => {
          if (!released) { released = true; active -= 1; }
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
        };
        const finish = value => {
          if (finished) return;
          finished = true;
          if (value) resolve(value);
          else reject(unavailable());
        };
        const kill = () => {
          if (child && child.exitCode === null && child.signalCode === null) {
            try { child.kill('SIGKILL'); } catch { /* fail closed */ }
          }
          finish(null); // Caller cannot trust a timed-out child.
        };
        const onAbort = () => kill();
        try {
          child = spawn(process.execPath, [childPath, mode], {
            shell: false,
            env: { MESH_SYNTHETIC_CHILD: '1' }, // never pass inherited secrets
            stdio: ['ignore', 'pipe', 'ignore'],
          });
          child.stdout.on('data', chunk => {
            size += chunk.length;
            if (size > 256) { kill(); return; }
            if (!finished) output += chunk.toString('utf8');
          });
          // A spawn/child error is not itself proof that OS resources closed.
          // Node emits close after error when stdio has actually shut down.
          child.once('error', kill);
          child.once('close', (exitCode, signalCode) => {
            release();
            if (finished) return;
            if (exitCode !== 0 || signalCode !== null) { finish(null); return; }
            const match = outputPattern.exec(output);
            if (!match) { finish(null); return; }
            const time = Date.parse(match[2]);
            if (!Number.isFinite(time) || new Date(time).toISOString() !== match[2]) {
              finish(null);
              return;
            }
            finish({ state: match[1], observed_at: match[2] });
          });
          signal.addEventListener('abort', onAbort, { once: true });
          // Admission is allocated before spawn; hard failure never returns
          // a fabricated source status, even if the child writes a late value.
          timer = setTimeout(kill, deadlineMs);
          if (signal.aborted) kill();
        } catch {
          kill();
          release();
        }
      });
    },
  });
}
