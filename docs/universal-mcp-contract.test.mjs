import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = readFileSync(new URL('./universal-mcp-contract.md', import.meta.url), 'utf8');

test('universal MCP contract retains distinct ownership and fail-closed gates', () => {
  for (const term of ['GoreeCloud Mesh', 'GoreeShield', 'Wardveil', 'Identity', 'Deny by default', 'tenant', 'human approval', 'protocol', 'nonproduction']) {
    assert.ok(contract.toLowerCase().includes(term.toLowerCase()), 'missing contract term: ' + term);
  }
});
test('contract does not claim deployment', () => {
  assert.match(contract, /No deployment is authorized/);
});
