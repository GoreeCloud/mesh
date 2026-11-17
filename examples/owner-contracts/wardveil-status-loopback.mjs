// Opt-in development transport for Wardveil's status-only /v1/status scope.
// Fixed 127.0.0.1 origin and path; bearer token is private to this closure.
// No remote URL, arbitrary request path, proxies, logs, retries or redirects.
import { request as httpRequest } from 'node:http';

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function snapshot(value, allowed, required) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => !allowed.includes(key)) ||
        required.some(key => !keys.includes(key))) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const result = Object.create(null);
    for (const key of keys) {
      const desc = descriptors[key];
      if (!desc || !own(desc, 'value')) return null;
      result[key] = desc.value;
    }
    return result;
  } catch {
    return null;
  }
}

export function createLoopbackWardveilStatusTransport(options) {
  const fields = snapshot(options, ['port', 'token', 'timeoutMs'], ['port', 'token']);
  if (!fields) throw new TypeError('invalid scoped status transport options');
  const port = fields.port;
  const token = fields.token;
  const timeoutMs = fields.timeoutMs ?? 500;
  const maxBytes = 256;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 ||
      typeof token !== 'string' || token.length > 1024 ||
      /^[A-Za-z0-9._~+/-]{32,1024}={0,2}$/.exec(token)?.[0] !== token ||
      !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 1000) {
    throw new TypeError('invalid scoped status transport limits');
  }
  return async function transport(input) {
    const fields = snapshot(input, ['method', 'path', 'signal'], ['method', 'path', 'signal']);
    if (!fields || fields.method !== 'GET' || fields.path !== '/v1/status' ||
        !(fields.signal instanceof AbortSignal)) {
      throw new TypeError('invalid scoped status transport request');
    }
    if (fields.signal.aborted) throw new Error('scoped status transport unavailable');

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('scoped status transport unavailable'));
      };
      const succeed = response => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      };
      let req;
      try {
        req = httpRequest({
          host: '127.0.0.1', family: 4, port, method: 'GET', path: '/v1/status',
          agent: false, signal: fields.signal, maxHeaderSize: 2048,
          headers: {
            Accept: 'application/json',
            Authorization: 'Bearer ' + token,
            Connection: 'close',
          },
        }, res => {
          // Node may normalize duplicate response headers. Reject ambiguous
          // Content-Type at the raw wire boundary before trusting its value.
          const securityHeaders = {
            'content-type': [],
            'cache-control': [],
            'x-content-type-options': [],
          };
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            const name = res.rawHeaders[i].toLowerCase();
            if (Object.hasOwn(securityHeaders, name)) {
              securityHeaders[name].push(res.rawHeaders[i + 1]);
            }
          }
          // The reviewed Wardveil Go owner handler sets these metadata
          // controls on all responses. Fail closed on omitted, duplicated,
          // cacheable or spoofed metadata, not just the JSON body.
          const contentTypes = securityHeaders['content-type'];
          if (contentTypes.length !== 1 ||
              securityHeaders['cache-control'].length !== 1 ||
              securityHeaders['cache-control'][0] !== 'no-store' ||
              securityHeaders['x-content-type-options'].length !== 1 ||
              securityHeaders['x-content-type-options'][0] !== 'nosniff') {
            req.destroy();
            fail();
            return;
          }
          const chunks = [];
          let size = 0;
          res.on('data', chunk => {
            size += chunk.length;
            if (size > maxBytes) {
              req.destroy();
              fail();
            } else if (!settled) {
              chunks.push(chunk);
            }
          });
          res.on('end', () => {
            if (fields.signal.aborted) return fail();
            succeed({
              status: res.statusCode,
              contentType: contentTypes[0],
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('aborted', fail);
          res.on('error', fail);
        });
        req.on('error', fail);
        timer = setTimeout(() => { req.destroy(); fail(); }, timeoutMs);
        req.end();
      } catch {
        if (req) req.destroy();
        fail();
      }
    });
  };
}
