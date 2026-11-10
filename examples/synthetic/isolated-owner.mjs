// Experimental fixed-code, nonproduction owner *process* boundary.
// No arbitrary path/plugin execution, network target, user payload or secrets.
// This is NOT an OS sandbox: the child retains the runner's FS/user privileges.
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const childPath = fileURLToPath(new URL('./isolated-owner-child.mjs', import.meta.url));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const modes = new Set(['ok', 'degraded', 'hang', 'crash', 'oversize', 'late']);
const FIXTURE_OWNER = 'fixture.alpha';
const FIXTURE_CAPABILITY = 'fixture.alpha.status';
const ACTOR_ID = /^[a-z][a-z0-9.-]{1,63}$/;
const unavailable = () => new Error('isolated fixture unavailable');
// Per-fixture-instance launch budget prevents an unrestricted crash/spawn loop.
// It is NOT a production worker quota, global supervisor, or OS sandbox.
const MAX_LAUNCHES_PER_WINDOW = 16;
const LAUNCH_WINDOW_MS = 60_000;

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

function checkedOwnFixtureCapability(value) {
  const c = fields(value, ['id', 'owner', 'version', 'operation', 'sensitivity', 'evidence_status']);
  if (!c || c.id !== FIXTURE_CAPABILITY || c.owner !== FIXTURE_OWNER ||
      c.version !== '0.0.1-fixture' || c.operation !== 'status.read' ||
      c.sensitivity !== 'synthetic' || c.evidence_status !== 'prototype') return null;
  // Give delayed permit callbacks a stable, value-only descriptor. Passing
  // the caller's original mutable object would let its identity change
  // after admission but before the asynchronous policy actually reads it.
  return Object.freeze({
    id: c.id, owner: c.owner, version: c.version,
    operation: c.operation, sensitivity: c.sensitivity,
    evidence_status: c.evidence_status,
  });
}

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
  // A direct owner read must consume exactly one prior successful authorization.
  // Weak keys do not retain abandoned/aborted request signals indefinitely.
  const authorizedSignals = new WeakSet();
  // Version each authorization attempt so a later denial or recheck revokes
  // any older pending allow, even when its policy callback resolves late.
  const authorizationVersions = new WeakMap();
  let active = 0;
  const starts = [];
  const pruneStarts = now => {
    while (starts.length && now - starts[0] >= LAUNCH_WINDOW_MS) starts.shift();
  };

  // An exported owner adapter may also receive direct untrusted callers.
  // Destructure no user-supplied context before validating its descriptors.
  const safeSignal = context => {
    const value = fields(context, ['signal']);
    try {
      return value?.signal instanceof AbortSignal ? value.signal : null;
    } catch { return null; }
  };

  return Object.freeze({
    async authorize(actor, capability, context = {}) {
      const signal = safeSignal(context);
      if (!signal) return false;
      // Every newer authorization attempt invalidates an older granted or
      // still-pending ticket, including when policy callbacks resolve out of order.
      const version = (authorizationVersions.get(signal) || 0) + 1;
      authorizationVersions.set(signal, version);
      authorizedSignals.delete(signal);
      try {
        // This fixed-code child serves only fixture.alpha.status. Do not
        // turn a permit for another advertised capability into a read ticket.
        if (signal.aborted || typeof actor !== 'string' || !ACTOR_ID.test(actor)) {
          return false;
        }
        const checked = checkedOwnFixtureCapability(capability);
        if (!checked) return false;
        const allowed = (await permit(actor, checked, { signal })) === true;
        if (!allowed || signal.aborted ||
            authorizationVersions.get(signal) !== version) return false;
        authorizedSignals.add(signal);
        return true;
      } catch { return false; }
    },
    activeCount() { return active; },
    launchesInWindow() {
      pruneStarts(performance.now());
      return starts.length;
    },
    async readStatus(context = {}) {
      const signal = safeSignal(context);
      try {
        if (!signal || !authorizedSignals.delete(signal) ||
            signal.aborted || active >= maxConcurrent) {
          throw unavailable();
        }
      } catch {
        throw unavailable();
      }
      // Charge attempted process starts even when spawn fails. Never admit a
      // crash loop as soon as each child closes; use monotonic time only.
      const now = performance.now();
      pruneStarts(now);
      if (starts.length >= MAX_LAUNCHES_PER_WINDOW) throw unavailable();
      starts.push(now);
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
          // A caller may shadow EventTarget cleanup on a genuine AbortSignal.
          // Cleanup must never throw from the child CLOSE handler.
          try { signal.removeEventListener('abort', onAbort); } catch { /* fail closed */ }
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
          // When spawn succeeded, OS capacity remains charged until CLOSE.
          // In particular, a hostile AbortSignal listener may throw AFTER
          // the subprocess started; immediate release would admit overlap.
          if (!child) release();
        }
      });
    },
  });
}
