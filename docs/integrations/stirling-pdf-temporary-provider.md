# Temporary Stirling PDF Provider — Chat Workflows and GoreeCloud Application Integration

| Property | Value |
| --- | --- |
| Prepared | November 20, 2026 |
| Ownership | GoreeCloud Mesh (integration design); local VPS administrator (temporary deployment); GoreeCloud PDF Manager (future replacement) |
| Type | Engineering design / operations reference, **not** a changelog or a deployed integration |
| Source of truth | GoreeCloud Google Drive is canonical for documentation; this repository file is a source-adjacent engineering proposal |
| Classification | Public-safe. Credentials, private infrastructure details, personal document contents and local secret paths are intentionally excluded |
| Decision | Reuse Stirling PDF temporarily behind a future provider-neutral interface; retire only after a verified GoreeCloud PDF Manager cutover |

## 1. What exists today — and what does not

This is an evidence-based snapshot, not a claim that a native GoreeCloud PDF product has shipped.

| Component | Status |
| --- | --- |
| Temporary third-party Stirling PDF instance | **Deployed and checked**, version 3.4.0; validated HTTPS status endpoint returned 200 and UP |
| Stirling API authentication | **Verified** HTTP 200 from an authorized VPS user's existing authenticated CLI |
| VPS-local CLI | **Installed and syntax-tested**; offers status, login, auth-check, compress, merge, fixed-host API request and logout |
| Local token storage | **Verified** owner-only mode 0600 file in a mode 0700 directory; token contents were not read or transmitted |
| End-to-end PDF operation | **Not yet validated** with a real sample PDF and output-content inspection |
| ChatGPT automation | **Conditional capability**, not a deployed chat tool: authorized Remote Desktop Commander access could execute the CLI while a live device connection and accessible files are available |
| GoreeCloud Mesh provider adapter | **Proposed only**; no actual connector, application-facing service, discovery endpoint or job worker deployed |
| GoreeCloud applications using this provider | **No verified application integration** |
| Independent off-host backup / restore | **Pending** |

**Important distinction:** a working personal API token on a VPS does not grant all GoreeCloud products access to that token, and does not imply that ChatGPT can process arbitrary chat attachments automatically.

## 2. Chat / assistant usage

For a specific, authorized task, a supported ChatGPT conversation could reach an authenticated CLI through the connected VPS:

    User requests authorized PDF operation
           |
    ChatGPT with Remote Desktop Commander access
           |
    VPS-local "stirling-pdf" CLI
           |
    HTTPS Stirling PDF API
           |
    Result file on the VPS -> separately authorized retrieval

Examples on the authorized VPS:

    stirling-pdf status
    stirling-pdf auth-check
    stirling-pdf compress input.pdf compressed.pdf
    stirling-pdf merge result.pdf one.pdf two.pdf
    stirling-pdf api GET /api/v1/info/uptime
    stirling-pdf --help

Files attached in chat are not automatically present on the VPS; VPS output files are not automatically downloadable in chat. Verify and authorize the upload/download path, document permissions, destination and retention before processing. A background agent, ChatGPT-native tool registration, MCP endpoint and file-transfer service are **not already installed** by this CLI.

Do not paste an API token into a model prompt, repository, command argument, browser bundle, log or support request. The personal CLI token is for the authorized operator, not a shared application credential.

## 3. Application architecture (proposal, NOT deployed)

    GoreeCloud web / Linux / Android client
        | authorized user request (GoreeCloud Identity)
        v
    GoreeCloud app backend
        | purpose, file policy, authorization, quotas
        v
    GoreeCloud Mesh PDF capability adapter
        | provider-independent job contract
        v
    Isolated processing worker -> temporary Stirling PDF API
        | integrity/content validation and retention
        v
    Scoped artifact delivery to the original authorized client

**Keep the API secret server-side.** Applications should use service credentials separate from the VPS operator's personal token, stored through an approved secret mechanism, only after the provider's supported permissions are verified. Neither browser JavaScript nor Android clients should contain an API key.

Mesh should own integration semantics and provider selection, while actual PDF functionality remains with the provider. This prevents the eventual GoreeCloud PDF Manager cutover from requiring changes in every consumer.

### Candidate contract — illustrative, not a deployed API

A provider-neutral contract may include:

- Capability discovery: compression, merging, splitting, OCR, conversion, supported file formats and validated version, each advertised only after provider tests.
- Job submission: requested operation, ordered inputs, options, requesting actor/service, purpose, retention, idempotency token and bounded quotas.
- Job state: accepted, queued, running, succeeded, failed, cancelled, expired.
- Result: short-lived actor-scoped access, content type, format, size, checksum, processing status, safe error details and expiry.
- Reliability: bounded concurrency, CPU/memory and upload limits, timeout, cancellation, safe cleanup, retry controls and backpressure.
- Private diagnostics: job identifiers, state, timing, error class and operational metrics, excluding payload content, tokens, credentials and document text.

Potential route names for *future design review* include POST /v1/pdf/jobs, GET /v1/pdf/jobs/{id}, GET /v1/pdf/capabilities and DELETE /v1/pdf/jobs/{id}. **Do not assume these routes exist or expose them before implementation.**

## 4. Potential GoreeCloud consumers (not integrated)

| Product | Candidate use | Key boundary |
| --- | --- | --- |
| GoreeCloud PDF Manager | Reuse temporary processing capabilities during native development | No dependency that prevents verified provider replacement |
| GoreeCloud AI | PDF OCR/preprocessing for permissioned document understanding | Explicit consent; never silently send private files to remote AI/model services |
| GoreeCloud Drive | Compress, convert or preview approved stored files | Storage ACLs, quotas, file retention |
| GoreeCloud Search | Index PDF content after authorized extraction | Corpus access and deletion propagation |
| GoreeCloud Tasks / Projects | Process authorized document attachments and reports | Per-project and per-task permissions |
| GoreeCloud Backup | Handle optional PDF reports or portable exports | Protect source snapshots and recovery integrity |
| GoreeCloud Teams | Convert or optimize explicitly shared PDF attachments | Group membership, sharing and expiry |

These are opportunities, not claims that the named applications or integrations are deployed or Stable. Start with **one** backend pilot.

## 5. Mandatory Integrated Platform Systems (MIPS)

- **GoreeCloud Mesh — integration:** discovery, provider adapter, version negotiation, routing, workflow coordination, bounded retries and interoperability.
- **GoreeCloud Identity — access:** authenticate actor/service, approve operation and authorize each input/output file. Never trust actor identity supplied only by a model.
- **GoreeShield — privacy:** purpose limitation, consent, data minimization, sharing policy, access transparency, retention and deletion. GoreeShield is **not** the cybersecurity suite.
- **Wardveil — cybersecurity:** PDF threat assessment, input validation, malware defenses, network/execution restrictions, abuse monitoring and incident-response boundaries.
- **GoreeCloud UI — design:** approved user-facing consent, upload, job status, error handling, accessibility and responsive interactions.

These requirements are not proof the temporary provider enforces them. They are acceptance gates for integration.

## 6. Security and reliability requirements

1. Use a backend/service worker with a separate least-privilege credential and a fixed allowlisted provider origin; validate TLS, authentication and transport. No client-side API keys.
2. Never reuse the personal CLI token as a system-wide Mesh or application credential. Verify the actual provider supports the desired scope before provisioning service access.
3. Validate PDF signatures, file type, size, page count, file count, output type and integrity; enforce hard CPU/memory/time/concurrency limits and restrict filesystem/network egress.
4. Prevent SSRF, path traversal, command injection, cross-tenant data access and uncontrolled downloading. PDFs are untrusted input; run processors in suitable isolation.
5. Stage files per job under restrictive permissions, expire outputs as configured, prevent hidden persistent copies and perform retention/deletion checks without logging source contents.
6. Use narrow, consent-aware audit metadata and safe alerts; do not log document bytes, extracted text, bearer links, passwords, or HTTP authentication headers.
7. Exercise error cases, input preservation, restart persistence, revocation, rate limiting, capacity, isolated restore and encrypted off-host recovery before wider rollout.
8. Do not expose additional host ports merely to make the integration work.

## 7. Implementation stages and acceptance

**Stage A — verified current checkpoint:** HTTPS Stirling 3.4.0 UP, CLI installed, local private token enrolled, auth-check HTTP 200. **Not** proof of real PDF processing.

**Stage B — pending operational tests:** execute authenticated compression and merging with disposable non-sensitive PDFs; verify output content, integrity, negative/error cases, data-retention behavior, backup and isolated restoration.

**Stage C — planned architecture:** define an adapter contract, capability probe, scoped credentials and policy review; implement with mocks and fail-closed identity/privacy/security tests before connecting actual documents.

**Stage D — planned consumer pilot:** connect a single backend, verify authz, limits, failures and output handoff, then expand consumer adoption based on observed benefit and remaining risk.

**Stage E — eventual retirement:** implement GoreeCloud PDF Manager to the same stable contract; verify functional parity, rollback and preservation of relevant settings/data; migrate consumers deliberately; revoke provider credentials and remove temporary routing only after founder-approved Stable acceptance. Do not purge recovery data prematurely.

## 8. Documentation ownership and blockers

- **Canonical internal documentation:** Google Drive under the authorized GoreeCloud/ folder. This public engineering note does not replace a canonical Drive record.
- **Operational VPS CLI instructions:** maintained privately beside the temporary Stirling deployment, including the actual CLI path and operator guidance.
- **Source-adjacent integration design:** this file in the GoreeCloud/mesh repository. No secret may enter this public repository.
- **Changelogs:** managed *only* through the approved GoreeCloud Changelogs CLI/MCP, not in this note.
- **Open items:** canonical Drive upload/update workflow, full PDF smoke test, secure remote artifact transfer, service credential provisioning, isolated backup/restore and actual Mesh/provider/app implementation.

**This document introduces no new deployed service, runtime dependency, scheduled job, or permission grant.**
