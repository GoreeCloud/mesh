# Remote Desktop Commander service CLI (VPS Mesh)

This opt-in, local operator tool is a temporary adapter maintained in **GoreeCloud/mesh**. It does not claim deployed GoreeCloud Mesh infrastructure, persistent agents, working production backups, or general cross-product authorization. Source: `tools/remote-service-cli/gc-services.py`. Python standard library only; no new listeners, cron jobs, daemon or Docker changes.

## Install (authorized VPS user only)
Copy the reviewed Python script to `~/.local/bin/gc-services` and set mode 0755. Run via Desktop Commander on device `goreecloud-vps-mesh`, or in an interactive SSH terminal. Only the authorized VPS operator and its existing Docker group should run administrative commands; Docker group has effectively root-equivalent powers.

## Commands

```sh
gc-services list
gc-services doctor
gc-services container list
gc-services container status goreecloud-temp-unbound
gc-services container logs goreecloud-temp-adguard --lines 50 --output ./adguard-private.log
gc-services caddy routes
gc-services caddy validate
gc-services login vikunja
gc-services login plane
gc-services login adguard
gc-services login stirling
gc-services auth-check vikunja
gc-services auth-check plane
gc-services auth-check adguard
gc-services auth-check stirling
gc-services api vikunja GET /api/v1/projects --output ./vikunja-private.json
gc-services api plane GET /api/v1/workspaces/WORKSPACE_SLUG/projects/
gc-services api adguard GET /control/status
gc-services api vikunja POST /api/v1/projects --data-file ./project.json --dry-run
# Only after independently confirmed permissions and recovery:
gc-services api adguard POST /control/filtering/refresh --confirm-write
gc-services api vikunja POST /api/v1/projects --data-file ./project.json --confirm-write
gc-services api stirling GET /api/v1/info/uptime
stirling-pdf compress input.pdf compressed.pdf
gc-services caddy reload --confirm-write
gc-services logout vikunja
```

**Warning:** Mutating API calls and Caddy reloads can alter live state. Verify target, backup/recovery, permission scope, API request schema and expected impact *before invoking* any example write. The examples are usage patterns, not tests or pre-authorized changes. Plane endpoint paths are version-dependent. For Stirling upload/multipart use its previously installed `stirling-pdf` wrapper.

## Authentication and data policy

Vikunja API tokens use `Authorization: Bearer`; Plane keys use `X-API-Key`; AdGuard uses HTTP Basic **over loopback only**. Enter secrets only through private TTY prompts after creating scoped credentials in the service. Successful login checks an authenticated endpoint before storing. Files live at `~/.config/goreecloud/service-cli/<service>.json` (0700 dir/0600 file), never in repository, process args, logs or ChatGPT conversation. Stirling retains its separate private credential/header.

All requests target hard-coded HTTPS GoreeCloud origins or the host's AdGuard loopback port. Redirects and environment proxies are refused to prevent credential forwarding. Write methods require `--confirm-write`. API replies can contain private user data: avoid broadcasting stdout; `--output` securely creates a non-overwriting 0600 output file. Data files must contain JSON and never be committed. For destructive operations require a service-specific, tested rollback. The caller's user/API role and Docker access still determine real authority.

Caddy `routes` intentionally shows only site-block names, not passwords or complete configuration. `validate` is read-only. `reload` validates first and writes a private **candidate** snapshot, but **does not guarantee a valid restore** or production acceptance. This wrapper cannot fix rollback if the Caddyfile has already been overwritten. Protect the mounted config and encrypted backups separately.

## Full operational specification

Read [VPS Service CLI Through Remote Desktop Commander](../../docs/REMOTE_DESKTOP_COMMANDER_SERVICE_CLI.md) for the runtime matrix, interim Plane/Vikunja ownership, private credential lifecycle, data handling, API v1/v2 version differences, verification evidence, production safety gates and follow-up priorities.

The source-controlled `stirling-pdf.py` is the exact temporary wrapper installed on VPS Mesh; its separate owner-private token file is never stored in GitHub. The companion `test_cli.py`, `test_api_transport.py`, and `test_stirling_cli.py` tests cover URL scoping, guarded writes and an isolated loopback fixture with synthetic bearer/API-key/Basic authentication and secure output; **no real production record writes** are exercised by these tests. Run with `python3 -m unittest discover -v -s tools/remote-service-cli -p 'test*.py'`.

## Extension and acceptance

Additional services need explicitly reviewed, fixed-origin adapters and least-privilege service identities; do not accept arbitrary untrusted URLs, request-supplied authorization headers, or unchecked redirects. Before promoting a connector, run simulated API tests, service-specific authenticated reads/writes using disposable records, role-denial checks, backup/restore drills where relevant, and full monitoring. Verify production traffic separately; no live records are modified by the initial smoke test.
