# Temporary Stirling PDF — Nonproduction Mesh Provider Contract

This is **source-owned, nonproduction code** for a future PDF-processing adapter. It is not a deployed service, plugin, MCP tool, web endpoint, consumer integration or access grant.

- adapter.mjs validates strict PDF request metadata, operation set and file counts (compress 1; merge 2–8), copies input data, supports explicit deny-by-default asynchronous authorization, timeouts with retained in-flight admission slots, and validates PDF-signature/type/size-limited response bytes.
- stirling-transport.mjs is an **opt-in server-side only** multipart HTTP helper with a fixed reviewed Stirling HTTPS origin and only two reviewed API routes. It requires an explicitly injected **service** credential; it never reads operator CLI token files, logs secrets or accepts arbitrary URLs. Responses are streamed with bounded size, redirects are not followed.
- adapter.test.mjs uses built-in node:test, synthetic fake PDF signatures and a mock fetch. Tests do not make any external requests or use credentials.

Run:

    node --test examples/pdf-provider/adapter.test.mjs

The isolated tests do NOT validate a real PDF parser or malicious-file safety. A separate one-off VPS test using existing authenticated operator CLI and two genuine disposable PDFs confirmed compression/merge page counts, extracted text and non-overwrite behavior. That evidence is not proof of the Mesh adapter, secure service credentials, operational privacy controls or real external-client compatibility.

## Integration contract

Call createPdfProviderContract({permit, transport}) with a **trusted** permit function. Deny is the default. Only after production GoreeCloud Identity, owner permissions, GoreeShield consent/purpose and Wardveil processing policy are in place should a service backend consider enabling a real transport. The current module does NOT establish or verify any of those systems.

The adapter always routes compress to POST /api/v1/misc/compress-pdf and merge to POST /api/v1/general/merge-pdfs; the transport pins https://stirling-pdf.goreecloud.com. No client-supplied origin, file paths, URL download parameters or output destination is accepted.

Transport example for future trusted server-side work (not a production-ready authentication snippet):

    const transport = createStirlingHttpsTransport({
      getServiceToken: async () => approvedSecretManager.getScopedToken(),
    });

This **must not** be configured with the VPS user's personal Stirling API token. No application-facing job API, durable queue, database, store, worker sandbox or token provisioning is implemented here.

## Acceptance still required

1. Confirm isolated tests pass in Node 24 CI and repository protections.
2. Provision a separate least-privilege service credential through an approved mechanism, including rotation/revocation.
3. Implement independent GoreeCloud Identity actor/resource authorization, GoreeShield consent/retention and Wardveil PDF security policy with negative tests.
4. Add suitably sandboxed worker execution with strict CPU, memory, file, page and concurrency budgets, cancellation, staging, cleanup and recovery.
5. Design an authorized file-transfer and response-delivery path. Model-visible chat files are not implicitly present on the VPS.
6. Recheck upstream API compatibility, TLS/remote routing, error handling, real PDF contents, backup/offsite recovery, rollback and migration to GoreeCloud PDF Manager.
7. Move to stable only on separately documented, measured evidence and approval; never interpret passing synthetic tests as production acceptance.

See docs/integrations/stirling-pdf-temporary-provider.md (proposed in PR #114) for broader architecture.
