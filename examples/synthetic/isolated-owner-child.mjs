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
  case 'hang': setInterval(() => {}, 1000); break;
  default: process.exit(23);
}
