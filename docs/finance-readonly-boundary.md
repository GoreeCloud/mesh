# GoreeCloud Mesh — finance read-only synthetic boundary

**Status:** Nonproduction reference; live integrations disabled. Reviewed 2026-11-13. This page does not assert that any bank supports a specific OAuth scope, aggregator, API product, or data field.

## Context

GoreeCloud Finance is a proposed private, read-only financial viewer for Navy Federal Credit Union, Cash App, Varo, Capital One, Marcus by Goldman Sachs, Discover, and PayPal. The independent local-only viewer prototype accepts **normalized, user-selected CSV statements** with `date,description,amount`, uses integer-cent arithmetic, and does not query institutions. This Mesh repository contains only a deliberately disabled synthetic capability catalog, not that frontend's full code or any financial record.

## Synthetic contract

- `examples/finance-readonly/manifest.mjs` names all seven institutions with `coverage=unverified`, `liveConnection=disabled`, and `grantedScopes=[]`.
- Recognized *intent names* `accounts.read`, `balances.read`, and `transactions.read` return `unavailable`, never permission to issue a request.
- Mutating intents (such as `payments.send`, `transfers.create`, or `accounts.write`) return `denied`. Unknown institutions return `unsupported`.
- The fixture makes no HTTP requests, reads no credentials, stores no personal data, and **cannot** promote an external API permission. A passing test does not authorize a bank connection.
- `examples/synthetic/finance-readonly.test.mjs` runs under the existing `npm test` glob and fails if a fixture institution unexpectedly reports live connectivity or a granted scope.

## Owner boundaries and MIPS

| Platform | Responsibility | Current evidence |
| --- | --- | --- |
| GoreeCloud UI | User-facing design, accessible states, and shared tokens | Local standalone prototype uses selected alpha tokens; no package or accessibility acceptance |
| GoreeCloud Mesh | Inventory, adapters, transport and synchronization | This disabled manifest and synthetic negative tests only |
| GoreeCloud Identity | User authentication, approved actor, tenant and access scopes | Not integrated |
| GoreeShield | Personal-data handling, consent, minimization, retention and withdrawal | Prototype has in-memory processing only; no service policy integration |
| Wardveil | Cybersecurity, threat policy, monitoring and incident response | Not integrated |

## Release blockers

1. Confirm each institution's approved access path, *account-type-specific* coverage, legal permission, exact source API, and permitted scopes. PayPal personal and business capabilities must not be conflated.
2. Integrate independently verified user authorization, institution consent/revocation, external provider scopes, secret lifecycle, TLS/workload identity, and source-side read-only enforcement. A UI toggle is never an API permission.
3. Define data quality, reconciliation, pagination, backfill, duplicate identity, timestamps, currencies, and account ownership. Imported net flows are **not account balances**.
4. Keep financial payloads out of public repositories, Drive code documentation, operational logs and synthetic fixtures. Use private storage only after a threat model, encryption, backups, retention controls, and explicit owner approval.
5. Finish end-to-end denial tests, isolation and fault recovery, browser/device/accessibility review, and formal five-MIPS acceptance before release.

**Do not deploy a connector from this manifest.** It has no transport, OAuth, identity, consent, bank credentials, or source-owner approval.
