# GoreeCloud Mesh — Live Identity Verifier Acceptance

GoreeCloud Mesh contains a source-controlled acceptance command at `cmd/identity-acceptance`. Its purpose is to prove that the Mesh Identity verifier can validate a **genuinely issued, short-lived GoreeCloud Identity service credential** through the **deployed Identity JWKS endpoint** using the same verifier implementation that Mesh uses at runtime.

This command is an evidence collector and gate. Its existence and source CI do not establish live or production acceptance.

## Required inputs

The acceptance command requires:

- the exact 40-character GoreeCloud Mesh revision under test;
- the exact 40-character GoreeCloud Identity revision responsible for the live issuer/JWKS deployment;
- the deployed HTTPS Identity JWKS URL;
- an absolute owner-only file containing one live compact Identity service JWT;
- the exact expected `service_id`; and
- one or more required Mesh scopes.

The normal GoreeCloud Identity issuer (`goreecloud-identity`) and Mesh audience (`goreecloud-mesh`) are not configurable acceptance escape hatches. The verifier remains authoritative for RS256 signature, signing-key, issuer, audience, temporal, service-subject, and structural validation.

## Required positive evidence

A successful run must prove all of the following against the live credential and JWKS endpoint:

1. the deployed JWKS can be retrieved through the hardened trust-anchor path;
2. the credential signature verifies against a usable deployed Identity signing key;
3. issuer and Mesh audience validation pass;
4. `service_id` equals the expected service and `sub` equals `service:<service_id>`;
5. every acceptance-required Mesh scope is present; and
6. a request without a bearer credential fails closed.

The command records only the verified service identity, subject, normalized scopes, exact source revisions, JWKS URL, a SHA-256 digest of the high-entropy credential for run correlation, and the pass/fail acceptance facts. It must not write the bearer credential, Identity private-key material, or reusable secret material to evidence. The evidence file is mode `0600`.

## Example invocation shape

The live credential itself must be delivered out of band into an owner-only file. Do not place it in shell history, source control, workflow summaries, tickets, or documentation.

```text
./identity-acceptance \
  --jwks-url https://<deployed-identity-host>/<jwks-path> \
  --token-file /run/goreecloud/identity/mesh-acceptance.jwt \
  --service-id <expected-service-id> \
  --required-scope mesh.evidence.write \
  --mesh-revision <exact-mesh-sha> \
  --identity-revision <exact-identity-sha> \
  --output /var/lib/goreecloud-mesh/evidence/identity-live-acceptance.json
```

The concrete deployed host/path and credential are environment evidence and are intentionally not invented in this repository.

## Acceptance boundary

A successful execution may establish `live_identity_verifier_acceptance=passed` for the exact Mesh revision, Identity revision, credential, JWKS endpoint, service identity, scopes, and environment represented by that run.

It does **not** by itself establish:

- GoreeCloud Identity production acceptance;
- Identity private-key custody or key-rotation acceptance;
- all Mesh API authorization paths;
- end-to-end evidence-producer delivery;
- cross-host availability or disaster recovery; or
- GoreeCloud Mesh production acceptance.

Those remain separate gates. Until live evidence exists, `contracts/mesh.identity-verification.json` intentionally keeps `live_identity_verifier_acceptance=false` and `production_acceptance=false`.
