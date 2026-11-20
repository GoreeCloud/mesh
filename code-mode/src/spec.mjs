import { SYNTHETIC_CATALOG } from './policy.mjs';

// This is a deliberately tiny, non-sensitive OpenAPI 3 contract.
// Code Mode's search tool can inspect it; execution remains host-mediated.
const capabilityResponse = {
  description: 'Synthetic-only, not a live health observation',
  content: { 'application/json': { schema: { type: 'object' } } },
};
const paths = Object.create(null);
paths['/v1/capabilities'] = {
  get: {
    operationId: 'listSyntheticCapabilities',
    summary: 'List fictional read-only Mesh capability descriptors',
    responses: { '200': capabilityResponse },
  },
};
for (const entry of SYNTHETIC_CATALOG) {
  paths['/v1/capabilities/' + entry.id] = {
    get: {
      operationId: 'readSynthetic_' + entry.id.replaceAll('.', '_'),
      summary: 'Read a synthetic fixture marker, not actual service health',
      responses: { '200': capabilityResponse },
    },
  };
}
export const OPENAPI = Object.freeze({
  openapi: '3.0.3',
  info: {
    title: 'GoreeCloud Mesh Code Mode synthetic-only API',
    version: '0.1.0',
    description: 'Nonproduction fixture. No live infrastructure, personal data, writes, or owner integrations.',
  },
  paths,
});
