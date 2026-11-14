# Mesh synthetic MCP tool metadata projection — November 13, 2026

**Scope:** one deliberately transportless local MCP-shaped development fixture. Not an MCP server, production gateway, OAuth implementation, external-client compatibility claim, or operational Mesh connection.

The existing dispatcher applies strict bounds and inert-record validation to an injected bridge's `tools/list` output, but previously forwarded the bridge-supplied `title` and `description` as client-visible natural-language metadata. A malicious or incorrectly wired bridge could therefore place arbitrary role/instruction text into a tool catalog consumed by an AI client, despite successful structural validation.

The source now validates the original bounded schema but projects fixed, non-authoritative, synthetic-only title and description text. Tool names must still match the restrictive `mesh__...__status_read` grammar; annotations remain `readOnlyHint=true`, `destructiveHint=false`, `openWorldHint=false`, and inputs remain empty. Regression tests confirm that adversarial catalog titles/descriptions cannot surface, while legitimate tool identity is preserved.

No transport, external permissions, credential handling, network access, model calls or deployment are introduced. Host Identity binding, permission revocation, rate limits, worker OS isolation, source-owned service validation, GoreeShield/Wardveil reviews, and Apache-2.0 repository license proposal PR #9 all remain independent review/release gates.
