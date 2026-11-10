// Development-only Mesh boundary for a trusted, independently verified
// GoreeCloud Identity decision. It never parses JWTs, trusts caller claims,
// performs source authorization by itself, or exports credentials.
// The verifyBearer function MUST come from a separately trusted verifier.
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const ACTOR = 'fixture.identity-verified';
const CAPABILITY = 'fixture.alpha.status';
// Defense in depth for many independently constructed fixture-reader instances.
// This is a per-Node-module-process cap, NOT a tenant/OS/global quota.
const MAX_SHARED_VERIFIERS = 8;
let sharedVerifying = 0;
const SCOPE = Object.freeze({
  tenantId: 'synthetic-family', resource: 'wardveil.status', action: 'read',
});
function snapshot(value, expected) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length || !expected.every(key => keys.includes(key))) return null;
    const fields = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of expected) {
      if (!fields[key] || !own(fields[key], 'value')) return null;
      result[key] = fields[key].value;
    }
    return result;
  } catch { return null; }
}

const deny = () => ({ ok: false, error: { code: 'denied' } });

export function createIdentityVerifiedFixtureReader(options) {
  const config = snapshot(options, ['harness', 'verifyBearer', 'timeoutMs', 'maxConcurrent']);
  // An exact option contract prevents untrusted requests from supplying
  // tenants, policies, application credentials, verifier URLs or actor claims.
  if (!config || typeof config.verifyBearer !== 'function' ||
      !Number.isInteger(config.timeoutMs) || config.timeoutMs < 10 || config.timeoutMs > 1000 ||
      !Number.isInteger(config.maxConcurrent) || config.maxConcurrent < 1 || config.maxConcurrent > 8) {
    throw new TypeError('invalid development Identity gate configuration');
  }
  const handler = snapshot(config.harness, ['discover', 'read']);
  if (!handler || typeof handler.read !== 'function' || typeof handler.discover !== 'function') {
    throw new TypeError('invalid synthetic Mesh harness');
  }
  const owner = config.harness;
  let verifying = 0;

  return Object.freeze({
    async read(input, context) {
      // Only the trusted hosting transport may supply a cancellation signal.
      // Inspect exact own data fields; never execute caller-owned getters.
      let callerSignal;
      if (context !== undefined) {
        const controls = snapshot(context, ['signal']);
        if (!controls) return deny();
        try {
          const intrinsic = Object.getOwnPropertyDescriptor(
            AbortSignal.prototype, 'aborted',
          )?.get;
          if (typeof intrinsic !== 'function' ||
              typeof intrinsic.call(controls.signal) !== 'boolean') return deny();
          callerSignal = controls.signal;
          if (intrinsic.call(callerSignal)) return deny();
        } catch { return deny(); }
      }
      const fields = snapshot(input, ['bearer']);
      const bearer = fields?.bearer;
      if (typeof bearer !== 'string' || bearer.length < 20 || bearer.length > 16384 ||
          !/^[A-Za-z0-9_-]+[.][A-Za-z0-9_-]+[.][A-Za-z0-9_-]+$/.test(bearer)) {
        return deny();
      }
      // The local verification budget cannot authorize an operation after
      // timeout. Uncooperative verifier work retains its admission slot.
      if (verifying >= config.maxConcurrent ||
          sharedVerifying >= MAX_SHARED_VERIFIERS) return deny();
      verifying += 1;
      sharedVerifying += 1;
      const controller = new AbortController();
      const signal = callerSignal
        ? AbortSignal.any([controller.signal, callerSignal])
        : controller.signal;
      let released = false;
      let started = false;
      const release = () => {
        if (!released) {
          verifying -= 1;
          sharedVerifying -= 1;
          released = true;
        }
      };
      let timer;
      let onAbort;
      try {
        // A disconnected caller stops waiting immediately. The verification
        // slot remains charged until the verifier itself settles, even if
        // it ignores abort. This prevents cancellation-based admission churn.
        const canceled = new Promise(resolve => {
          onAbort = () => resolve(false);
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        });
        timer = setTimeout(() => controller.abort(), config.timeoutMs);
        // Bearer and request-specific scope are passed directly to the trusted
        // verifier; no unverified claims or caller-supplied tenant is accepted.
        const verification = Promise.resolve().then(() =>
          signal.aborted ? false : config.verifyBearer(bearer, SCOPE, { signal }));
        started = true;
        void verification.then(release, release);
        let result;
        try { result = await Promise.race([verification, canceled]); }
        catch { return deny(); }
        if (result !== true || signal.aborted) return deny();
        // The underlying Mesh harness runs its own independent owner permit,
        // admission and source status validation after Identity allows.
        try {
          const outcome = await Promise.race([
            Reflect.apply(handler.read, owner, [{
              actor: ACTOR, capabilityId: CAPABILITY, operation: 'status.read',
            }]),
            canceled,
          ]);
          return signal.aborted || outcome === false ? deny() : outcome;
        } catch { return deny(); }
      } finally {
        if (timer) clearTimeout(timer);
        if (onAbort) signal.removeEventListener('abort', onAbort);
        controller.abort();
        if (!started) release();
      }
    },
  });
}
