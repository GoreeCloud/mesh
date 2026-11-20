# GoreeCloud Mesh · Cloudflare Code Mode fixture

This is a synthetic-only, nonproduction MCP Worker for experimenting with Cloudflare Code Mode search and execute tools. It is not a deployment, a production identity provider, or a live GoreeCloud service connector.

See the complete architecture and acceptance gates in ../docs/cloudflare-code-mode.md.

## Disposable development tests

From the repository root:

```sh
node --test code-mode/test/*.test.mjs
cd code-mode
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node test/local-smoke.mjs
node scripts/review-dependencies.mjs
npm audit --omit=dev --audit-level=high
```

The local smoke runs only fixed, reviewed synthetic JavaScript against a 127.0.0.1 Wrangler development Worker, creates a random .dev.vars credential, and deletes it afterward. Cloudflare warns that local Miniflare is not hardened for untrusted code; use an isolated test runner. Never execute arbitrary generated code on personal or production machines.

The Worker has no public route (workers_dev=false), no source-embedded credential, no owner API access and no real infrastructure mutations. A successful local run does not establish remote Worker Loader isolation, tenant authorization, revocation, or production readiness.
