import { readFileSync } from 'node:fs';
import { createSyntheticHarness } from './harness.mjs';

export const manifest = JSON.parse(readFileSync(new URL('./manifest.v1.json', import.meta.url), 'utf8'));

// No external data, listener, token or side effect. The actor and owner grants are
// deliberately separate and explicitly local to this fixture demonstration.
export function createFixtureHarness() {
  const adapters = Object.create(null);
  for (const capability of manifest.capabilities) {
    adapters[capability.id] = {
      authorize: actor => actor === 'fixture.reader',
      readStatus: async () => ({ state: 'ok', observed_at: '2026-10-26T00:00:00.000Z' }),
    };
  }
  return createSyntheticHarness({
    manifest,
    adapters,
    meshPermit: actor => actor === 'fixture.reader',
  });
}
