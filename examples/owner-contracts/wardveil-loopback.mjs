// Opt-in Node.js local transport for the Wardveil /healthz contract fixture.
// It cannot select a hostname, URL, path, method, credentials or proxy.
// It is a development-only loopback HTTP check, not a production connector.
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

export function createLoopbackWardveilHealthTransport(options) {
  const fields = snapshot(options, ['port', 'timeoutMs', 'maxBytes'], ['port']);
  if (!fields) throw new TypeError('invalid loopback transport options');
  const port = fields.port;
  const timeoutMs = fields.timeoutMs ?? 500;
  const maxBytes = fields.maxBytes ?? 256;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 1000 ||
      !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 256) {
    throw new TypeError('invalid loopback transport limits');
  }
  return async function transport(input) {
    const fields = snapshot(input, ['method', 'path', 'signal'], ['method', 'path', 'signal']);
    if (!fields || fields.method !== 'GET' || fields.path !== '/healthz' ||
        !(fields.signal instanceof AbortSignal)) {
      throw new TypeError('invalid loopback health request');
    }
    if (fields.signal.aborted) throw new Error('loopback health unavailable');

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('loopback health unavailable'));
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
          host: '127.0.0.1', family: 4, port, method: 'GET', path: '/healthz',
          agent: false, signal: fields.signal, maxHeaderSize: 2048,
          headers: { Accept: 'application/json', Connection: 'close' },
        }, res => {
          // Node may normalize duplicate response headers. Reject ambiguous
          // Content-Type at the raw wire boundary before trusting its value.
          const contentTypes = [];
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            if (res.rawHeaders[i].toLowerCase() === 'content-type') {
              contentTypes.push(res.rawHeaders[i + 1]);
            }
          }
          if (contentTypes.length !== 1) {
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
