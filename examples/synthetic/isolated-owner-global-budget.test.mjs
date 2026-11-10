import test from 'node:test';
import assert from 'node:assert/strict';
import { createIsolatedSyntheticOwner } from './isolated-owner.mjs';
import { manifest } from './fixtures.mjs';

// Run in this separately loaded Node test module to avoid artificially
// depleting another unrelated fixture's rolling launch budget.
test('new adapters cannot bypass the shared 64-launch window', async () => {
  const make = () => createIsolatedSyntheticOwner({
    mode: 'crash', deadlineMs: 800, maxConcurrent: 1,
    permit: () => true,
  });
  for (let i = 0; i < 64; i++) {
    const owner = make();
    const signal = new AbortController().signal;
    assert.equal(await owner.authorize(
      'fixture.reader', manifest.capabilities[0], { signal }
    ), true);
    await assert.rejects(
      owner.readStatus({ signal }), /^Error: isolated fixture unavailable$/
    );
    assert.equal(owner.activeCount(), 0);
    assert.equal(owner.launchesInWindow(), 1,
      'an accepted launch must charge its own instance');
  }
  for (let i = 0; i < 5; i++) {
    const refused = make();
    const signal = new AbortController().signal;
    assert.equal(await refused.authorize(
      'fixture.reader', manifest.capabilities[0], { signal }
    ), true);
    await assert.rejects(
      refused.readStatus({ signal }), /^Error: isolated fixture unavailable$/
    );
    assert.equal(refused.activeCount(), 0);
    assert.equal(refused.launchesInWindow(), 0,
      'shared over-budget refusal cannot start or charge another child');
  }
});
