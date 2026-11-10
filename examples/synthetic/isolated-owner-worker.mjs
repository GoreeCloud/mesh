// Fixed-code, disposable worker fixture. Not a sandbox for arbitrary owner code.
// No dynamic imports, secrets, files, sockets, network or production actions.
import { parentPort, workerData } from 'node:worker_threads';

const MODES = ['ok', 'degraded', 'hang', 'throw', 'invalid'];
if (!parentPort || !workerData ||
    Object.getPrototypeOf(workerData) !== Object.prototype ||
    !MODES.includes(workerData.mode) || Reflect.ownKeys(workerData).length !== 1) {
  throw new Error('invalid disposable worker fixture');
}

if (workerData.mode === 'hang') {
  // Proves a non-cooperative synchronous owner cannot block the Mesh caller.
  // The parent is required to terminate this worker at a hard deadline.
  for (;;) { /* fixed CPU loop, never input-controlled script execution */ }
}
if (workerData.mode === 'throw') {
  throw new Error('synthetic owner failure');
}
const observed_at = '2026-11-10T12:00:00.000Z';
const result = workerData.mode === 'invalid'
  ? { state: 'ok', observed_at, private_note: 'synthetic-only' }
  : { state: workerData.mode, observed_at };
parentPort.postMessage(result);
