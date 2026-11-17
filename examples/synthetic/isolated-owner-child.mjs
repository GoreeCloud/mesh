import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// Fixed-code, development-only subprocess used by isolated-owner.mjs.
// No plugins, eval, network, credentials, file reads, or external owner APIs.
if (process.env.MESH_SYNTHETIC_CHILD !== '1') process.exit(21);
const mode = process.argv[2];
const emit = state => {
  process.stdout.write(JSON.stringify({
    state, observed_at: new Date().toISOString(),
  }) + '\n');
};
switch (mode) {
  case 'ok': emit('ok'); break;
  case 'degraded': emit('degraded'); break;
  case 'crash': process.exit(22); break;
  case 'oversize': process.stdout.write('x'.repeat(1024)); break;
  case 'late': setTimeout(() => emit('ok'), 2000); break;
  case 'tree-hang': {
    // Spawn exactly one fixed-code descendant, not arbitrary executables.
    // It inherits this process's stdout pipe so the OS-side child CLOSE
    // cannot occur unless the entire owned process group terminates.
    if (process.platform === 'win32') process.exit(24);
    const grandchild = spawn(process.execPath, [fileURLToPath(import.meta.url), 'hang'], {
      shell: false,
      detached: false,
      stdio: ['ignore', process.stdout, 'ignore'],
      env: { MESH_SYNTHETIC_CHILD: '1' },
    });
    grandchild.once('error', () => process.exit(25));
    setInterval(() => {}, 1000);
    break;
  }
  case 'hang': setInterval(() => {}, 1000); break;
  default: process.exit(23);
}
