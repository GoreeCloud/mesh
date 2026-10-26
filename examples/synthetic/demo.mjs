import { createFixtureHarness } from './fixtures.mjs';

const harness = createFixtureHarness();
const capabilities = harness.discover();
const result = await harness.read({
  actor: 'fixture.reader',
  capabilityId: 'fixture.alpha.status',
});
process.stdout.write(`${JSON.stringify({ environment: 'synthetic-local-only', capabilities, result }, null, 2)}\n`);
