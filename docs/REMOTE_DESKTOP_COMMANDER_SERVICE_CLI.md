# GoreeCloud — VPS Service CLI Through Remote Desktop Commander

| Document control | Value |
| --- | --- |
| Type | CLI implementation, operations, and verification reference |
| Founder direction | Read and write authorized application data through Remote Desktop Commander using secure, service-supported interfaces |
| Technical source | [GoreeCloud/mesh](https://github.com/GoreeCloud/mesh), `tools/remote-service-cli/` |
| Responsible runtime | `goreecloud-vps-mesh`; authorized owner-user installation |
| Prepared | November 20, 2026 (America/Chicago) |
| State | Opt-in development adapter installed and locally tested; **not** production-certified Mesh |
| Canonical documentation authority | Google Drive `GoreeCloud/`; this repository file documents actual source and operator commands, not an alternative governance master |

## Founder requirement and scope

I require Remote Desktop Commander to let me **inspect, read, create, update, and where appropriately authorized delete** data and settings in my self-hosted applications. This includes Vikunja, Stirling PDF, AdGuard Home, Plane, Caddy, and other installed services. I prioritize official APIs, private credentials, reliable verification, recoverable changes, data ownership, and reuse through GoreeCloud Mesh over unrestricted host access or duplicated administration stacks.

This is a real technical implementation priority, not proof that every application currently has authenticated write access. A CLI wrapper and a running container are not evidence that application API permissions, record migrations, backup restoration, or automated synchronization exist.

**Operating authorities:** Plane is the interim source of truth for projects and project-management records, Vikunja for tasks and obligations, GitHub for repository source/PRs/CI, Google Drive `GoreeCloud/` for Markdown documentation, and the owning host/application for runtime state. Remote Desktop Commander is a transport to the authorized device—not authentication or authorization inside an application. Preserve historical Todoist/Linear records until each migration is explicitly reconciled.

## Actual deployment and runtime inventory

The authorized VPS is `goreecloud-vps-mesh` on Debian 13 Linux. Remote Desktop Commander listed this VPS and the personal laptop online when inspected. The installed operator wrapper is `~/.local/bin/gc-services` (Python standard library; executable mode 0755), with a pre-existing `~/.local/bin/stirling-pdf` wrapper for PDF operations, now also preserved as reviewed source under `tools/remote-service-cli/stirling-pdf.py` in draft PR #113. The public GitHub repository is `GoreeCloud/mesh`; the implementation initially lives in [draft PR #113](https://github.com/GoreeCloud/mesh/pull/113), not automatically on protected `main`.

| Service | Observed runtime | CLI capability / authentication | Acceptance |
| --- | --- | --- | --- |
| Vikunja | `goreecloud-temp-vikunja` running; public `/api/v1/info` and `/api/v2/info` returned HTTP 200 | Fixed HTTPS REST origin, bearer API token; v1 and v2 path scopes; GET/POST/PUT/PATCH/DELETE as permitted | Public info read + simulated transport validated; actual private token and record writes **pending** |
| Plane | v1.5.0 self-host stack, including API, web, worker, DB, queue, cache, and object storage containers | Fixed HTTPS REST origin, `X-API-Key`; v1 path scope | Public web HTTP 200, unauthenticated v1 user endpoint 401; v2 user endpoint 404 on installed version; private API test **pending** |
| AdGuard Home | `goreecloud-temp-adguard` running, admin control on host loopback port | HTTP Basic over `127.0.0.1` loopback only; `/control/` API | Unauthenticated `/control/status` returned 401; authenticated read/write **pending** |
| Stirling PDF | `goreecloud-temp-stirling-pdf` healthy, v3.4.0 reported in prior CLI documentation | Existing `stirling-pdf` wrapper for user API token, PDF merge/compress, fixed HTTPS endpoint; `gc-services` delegates basic API calls | Public status 200; live API token header not enrolled; real PDF processing via authorized token **pending** |
| Caddy | `goreecloud-temp-caddy` running and serving current routes | Read site-block hostnames; validate mounted Caddyfile; live reload only with `--confirm-write` | Configuration validation passed; live reload and recovery **not** exercised |
| Vaultwarden | `goreecloud-temp-vaultwarden` healthy | Docker status/log snapshots only; no unauthorized vault/database API access | Runtime metadata observed; admin/read/write API **not** integrated |
| Unbound | `goreecloud-temp-unbound` running | Docker status/log snapshots; no unreviewed DNS mutations | Runtime metadata observed; direct DNS control **not** integrated |
| Plane infrastructure | PostgreSQL, Valkey, RabbitMQ, and object-storage containers running | Docker inventory, bounded status, and owner-private log snapshot | Not general-purpose direct DB writes; never bypass Plane's API |

Container state can change; the observations above are not continuous monitoring. Neither an existing local database nor Docker access grants authority to bypass application controls. GoreeCloud Containers remains the preferred deployment option when verified installed/suitable; the observed VPS currently runs Docker/Compose.

## Architecture and trust boundaries

```text
ChatGPT / owner command
    └── authorized Remote Desktop Commander
          └── existing VPS user session
                ├── gc-services (stdlib; no listening socket or agent)
                │     ├── Vikunja /api/v1/ or /api/v2/ over fixed HTTPS
                │     ├── Plane /api/v1/ over fixed HTTPS
                │     ├── AdGuard /control/ via host loopback HTTP
                │     ├── Docker read-only inventory/status/private logs
                │     └── Caddy container validate, route names, guarded reload
                └── existing stirling-pdf CLI
                      └── fixed HTTPS API with separate owner-only token header
```

**GoreeCloud Mesh** owns the intended interoperability contracts; **GoreeCloud Identity** owns authentication/authorization; **GoreeShield** owns personal-data privacy and minimization; **Wardveil** owns cybersecurity and secure operations; **GoreeCloud UI** remains the design authority for future visible interfaces. The temporary CLI is *not* a deployed Mesh control plane, MCP transport, blanket administrator, or automatic synchronization service.

### Private credential model

- Authenticate separately in each owning application; create a scoped token/account with only the permissions needed. No service tokens were provided to the assistant or written into source.
- Use an interactive, private VPS terminal for `gc-services login vikunja|plane|adguard|stirling`. Never paste a token into ChatGPT, a command line, a GitHub issue, or a document. Automated Remote Desktop Commander calls are not a substitute for private hidden input.
- The three `gc-services` credentials are stored in an owner-owned `0700` directory at `~/.config/goreecloud/service-cli/` as mode `0600` JSON files; login authenticates with a read request before saving. Stirling retains its separate `~/.config/goreecloud/stirling-pdf/api-header` mode `0600` file.
- Credential readback checks the owning UID, regular-file type, and file/directory permissions. Redirects and environment-configured HTTP proxies are rejected, so the fixed-origin request cannot forward the credential to a different hostname.
- `logout` removes only local stored credentials. **It does not revoke a token or password inside the server**; revoke from the application as well when retiring access.
- Native service permissions remain authoritative. The VPS operator's Docker group access is effectively host-root-level authority and should be restricted accordingly.

### API data, writes and safety

- Approved URL origins are compiled into the operator adapter; user-supplied arbitrary origins are not permitted. API paths are confined to the service's namespace; suspicious fragments, traversal, double encoding, control characters, and untrusted host/scheme components are rejected.
- GET and HEAD are read operations. POST/PUT/PATCH/DELETE require explicit `--confirm-write` and a supported endpoint. This switch is a *guard*, not permission to perform destructive, bulk, public, or irreversible changes.
- `--dry-run` performs offline method/path/JSON-file validation **without contacting the service**. It cannot certify real API permissions, payload schema, persistence, or rollback.
- JSON payload files are at most 2 MiB and never placed into command arguments; API responses are limited to 8 MiB. A private `--output` destination is created mode `0600` without overwriting an existing file. Avoid printing sensitive response bodies to ChatGPT.
- Caddy reload requires explicit confirmation and passes syntax validation first. It writes a snapshot of the **current candidate file**, not a guarantee of restoring the previously active runtime state. Check real routing/TLS after any authorized change; have a recovery snapshot and tested rollback independently.
- Docker log capture requires `--output` and saves a bounded tail in a private `0600` file, never plain standard output. Logs may still contain secrets; inspect/redact before sharing. Docker status is restricted to a known local container name and fields that do not expose environment, mounts, or credentials.

## Operator command reference

Use from a private terminal on VPS Mesh, or as an authorized Remote Desktop Commander execution with the correct `deviceId`.

```bash
# Read-only inventory/health
gc-services list
gc-services doctor
gc-services container list
gc-services container status goreecloud-temp-vikunja
gc-services container status goreecloud-temp-unbound
gc-services container logs goreecloud-temp-adguard --lines 50 --output ./adguard-private.log
gc-services caddy routes
gc-services caddy validate

# Private enrollment (requires an actual interactive TTY)
gc-services login vikunja
gc-services login plane
gc-services login adguard
gc-services login stirling

# Credential validation (no private profile body printed)
gc-services auth-check vikunja
gc-services auth-check plane
gc-services auth-check adguard
gc-services auth-check stirling

# Authorized reads after enrollment
gc-services api vikunja GET /api/v1/projects --output ./vikunja-projects.json
gc-services api plane GET /api/v1/workspaces/WORKSPACE_SLUG/projects/
gc-services api adguard GET /control/status

# Validate a prospective write without sending it
gc-services api vikunja POST /api/v1/projects --data-file ./new-project.json --dry-run

# Real mutation template (run only with scoped permission and independent recovery)
gc-services api vikunja POST /api/v1/projects --data-file ./new-project.json --confirm-write

# Existing PDF processing wrapper (separate API token required)
stirling-pdf status
stirling-pdf auth-check
stirling-pdf compress input.pdf compressed.pdf
stirling-pdf merge merged.pdf first.pdf second.pdf

# Conditional configuration change (NOT exercised on production)
gc-services caddy reload --confirm-write

# Local key removal is not server-side revocation
gc-services logout vikunja
```

Any payload and output examples are procedural patterns, not evidence the corresponding application operation was successfully executed. Before executing a real write, discover existing records, validate exact IDs and permissions, request only approved changes, preserve unrelated data, and read back the owning application. Plane's workspaces/projects and Vikunja's tasks should not be invented or duplicated.

## Verification evidence

Tests performed on the authorized VPS with Python 3.13.5:

- `python3 -m py_compile ~/.local/bin/gc-services` succeeded.
- Thirteen isolated Python unit/transport tests passed: fixed-path scope, double-decoded traversal rejection, no automatic redirect, write confirmation gate, private TTY requirement, missing credential denial, dry-run behavior, simulated Vikunja bearer POST JSON, Plane API-key GET, AdGuard Basic GET, owner-only response file/no overwrite, and Stirling's private token/URL guards.
- HTTP checks returned 200 for Vikunja v1/v2 public info, Plane web, and Stirling PDF public status; 401 for unauthenticated Plane v1 current user and host-loopback AdGuard status; 404 for installed Plane v2 current user.
- Caddy `validate` succeeded without reload. Existing Docker container enumeration and Vikunja container status were read successfully.
- Dedicated GitHub Actions `VPS service CLI safety checks` passed on the preceding commit; the new head must be rechecked. Other pinned Mesh CI workflows failed on a previous head and must be investigated independently; do not assert a clean overall PR.

**Not tested or not configured:** Real Vikunja/Plane/AdGuard API credential enrollment or CRUD, Stirling real token enrollment/PDF upload, application RBAC denial tests, data restore, production Caddy reload/rollback, isolated service credential rotation, end-to-end multi-device workflows, automated Plane/Vikunja synchronization, real-time monitoring, and GoreeCloud Identity delegation. A read-only status response is not release acceptance.

## Continued priorities and acceptance

1. **Credential enrollment:** The owner privately enrolls least-privilege service tokens via a real TTY. Confirm credential file ownership, `gc-services auth-check` and intended scope without printing token or user data.
2. **Application-level CRUD:** Test Vikunja task/project and Plane workspace issue/project reads first, then disposable record create/update/delete with readback and service-specific rollback; test AdGuard read and a narrowly scoped reversible configuration change in a suitable staging/test window. Do not alter actual private records solely to demonstrate API access.
3. **Stirling processing:** Enroll the already issued API token privately, validate authorization, process a disposable test PDF, verify resulting PDF and remove test data according to retention controls.
4. **Caddy reliability:** Compare mounted file and active runtime where supported, preserve a known-good backup and independently tested restoration path; validate Caddy routes and TLS before any live reload.
5. **Other services:** Add documented adapters after verifying supported APIs, exact versions, authority, least-privilege credentials, read/write scope, monitoring, backup, and recovery. Prioritize Vaultwarden-safe administration (no vault bypass), Unbound diagnostics, Docker/Compose inventory, and first-party GoreeCloud Containers where present; do not treat direct database writes as an acceptable shortcut.
6. **CI and rollout:** Resolve failing cross-project Mesh workflows, review the draft PR and history/privacy risks, verify protected-branch gates and official checks, and merge only when appropriate. Container/CLI source and documentation are maintained in GitHub; device installation is a separately verified runtime state.
7. **Documentation and task synchronization:** Copy verified operational conclusions into the existing canonical Google Drive GoreeCloud documentation *in place*, preserving raw Markdown file IDs; maintain new obligations in Vikunja as soon as API access is real. Existing Todoist obligations are legacy and should not be silently discarded, duplicated, or declared migrated.

### Recovery and removal

The wrapper itself has no daemon, network listener, systemd unit, scheduled job or new container. Removing the executable disables this convenience interface without shutting down the existing applications. Remove credentials from the private folder after server-side revocation. Do not remove data volumes, service containers, Caddy routing, or the existing Stirling adapter as part of an unverified CLI retirement. Revert source through reviewable GitHub changes and validate unaffected workflows before rollout.

## Authoritative references

- [GoreeCloud governing instructions](https://docs.google.com/document/d/1W7eCxfSEw1_fpK7wSw8gfeHHCIJ8IrBE/edit)
- [Operational Roles](https://docs.google.com/document/d/15JC0_bBIJNTESgACwahWnHRJO8WOjIhg/edit)
- [Remote Desktop Commander / Plane / Vikunja operating instruction](https://docs.google.com/document/d/1RVk0WiPfrAFpOr_FMzeI_xiv0taRSuyi/edit)
- [Remote-device access instruction](https://docs.google.com/document/d/1gmK9yepqk4Yganm9HpfKANOGL4CEvaEz/edit)
- [“Document This” protocol](https://docs.google.com/document/d/1CwGK2fGh_vVW7QDEd0sX6jMOMTQKefQ1/edit)
- [GoreeCloud Mesh repository](https://github.com/GoreeCloud/mesh)
- [Draft implementation PR #113](https://github.com/GoreeCloud/mesh/pull/113)
- [Vikunja API documentation](https://vikunja.io/docs/api-documentation/)
- [Plane API v1 documentation](https://developers.plane.so/api-reference/introduction)
- [AdGuard Home OpenAPI](https://github.com/AdguardTeam/AdGuardHome/blob/master/openapi/openapi.yaml)

This document is technically scoped to the source implementation; it does **not** assert that the canonical Google Drive Markdown file has been updated, that credentials were provisioned, or that production writes succeeded. 
