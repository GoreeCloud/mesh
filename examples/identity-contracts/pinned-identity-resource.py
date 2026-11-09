"""Disposable signed-token acceptance bridge for the PINNED Identity source.

Only used by GitHub-hosted Mesh CI; not a JWT server, identity provider,
production JWKS client, token issuer, or credential management service.
The Python source is read from an immutable, verified checkout.
No token is logged; the JSON lines are private child-process IPC.
"""
import base64
import json
import sys
import time
from pathlib import Path

identity_source = Path(__file__).resolve().parents[2] / "identity-source" / "src"
if not (identity_source / "goreecloud_identity" / "resource_server.py").is_file():
    raise SystemExit(2)
sys.path.insert(0, str(identity_source))

import jwt  # noqa: E402 (source-owned dependency, installed in isolated CI)
from cryptography.hazmat.primitives.asymmetric import rsa
from goreecloud_identity.jwks_trust import JWKSUnavailable
from goreecloud_identity.policy import AccessRequest, PolicyRule
from goreecloud_identity.resource_server import ResourceAuthorizer, ResourceIdentityConfig

ISSUER = "https://identity.example.test/realms/goreecloud"
AUDIENCE = "goreecloud-mesh-status"
CLIENT = "goreecloud-mesh-fixture"
TENANT = "synthetic-family"
KID = "mesh-isolated-fixture"
SCOPE = "mesh:status:read"


def b64int(number):
    return base64.urlsafe_b64encode(
        number.to_bytes((number.bit_length() + 7) // 8, "big")
    ).rstrip(b"=").decode("ascii")


def fixture_tokens():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub = key.public_key().public_numbers()
    jwks = {"keys": [{
        "kty": "RSA", "use": "sig", "alg": "RS256", "kid": KID,
        "n": b64int(pub.n), "e": b64int(pub.e),
    }]}
    now = int(time.time())
    claims = {
        "iss": ISSUER, "sub": "disposable-ci-subject", "aud": AUDIENCE,
        "azp": CLIENT, "goreecloud_tenant": TENANT,
        "iat": now - 10, "nbf": now - 10, "exp": now + 240,
        "typ": "Bearer", "scope": "openid " + SCOPE,
        "realm_access": {"roles": ["mesh-status-reader"]},
    }

    def sign(changes=None, kid=KID):
        return jwt.encode(
            {**claims, **(changes or {})}, key, algorithm="RS256",
            headers={"kid": kid},
        )

    specimens = {
        "valid": sign(),
        "wrong_tenant": sign({"goreecloud_tenant": "unrelated-tenant"}),
        "wrong_audience": sign({"aud": "other-api"}),
        "wrong_client": sign({"azp": "unknown-app"}),
        "missing_scope": sign({"scope": "openid"}),
        "wrong_role": sign({"realm_access": {"roles": ["ordinary-reader"]}}),
        "explicit_deny": sign({"realm_access": {"roles": [
            "mesh-status-reader", "mesh-status-blocked",
        ]}}),
        "expired": sign({"exp": now - 120}),
        "id_token": sign({"typ": "ID"}),
        "wrong_issuer": sign({"iss": "https://other.invalid/realms/goreecloud"}),
        "unknown_signer": sign(kid="untrusted-kid"),
    }
    absent_tenant = {k: v for k, v in claims.items() if k != "goreecloud_tenant"}
    specimens["missing_tenant"] = jwt.encode(
        absent_tenant, key, algorithm="RS256", headers={"kid": KID}
    )
    specimens["wrong_algorithm"] = jwt.encode(
        claims, "synthetic-not-a-service-secret",
        algorithm="HS256", headers={"kid": KID},
    )
    # This material never leaves the local CI process except to its Node parent
    # on a private pipe. Its private signing key is not serialized or retained.
    return {"jwks": jwks, "tokens": specimens}


class FixturePinnedPublicKeys:
    """Deterministic offline key selection. NOT a production JWKS trust root."""
    issuer = ISSUER

    def __init__(self, jwks):
        self.jwks = jwks

    def for_key(self, kid):
        if kid != KID:
            raise JWKSUnavailable("untrusted signing key")
        return self.jwks


def verify(payload):
    if set(payload) != {"op", "token", "jwks"}:
        return False
    token = payload.get("token")
    jwks = payload.get("jwks")
    if not isinstance(token, str) or len(token) > 16384:
        return False
    if not isinstance(jwks, dict) or set(jwks) != {"keys"}:
        return False
    try:
        config = ResourceIdentityConfig(
            ISSUER, AUDIENCE, CLIENT, TENANT, frozenset({SCOPE}),
        )
        rules = [
            PolicyRule(TENANT, "wardveil.status", "read", "allow",
                       roles=frozenset({"mesh-status-reader"})),
            PolicyRule(TENANT, "wardveil.status", "read", "deny",
                       roles=frozenset({"mesh-status-blocked"})),
        ]
        verifier = ResourceAuthorizer(
            config, FixturePinnedPublicKeys(jwks), rules,
        )
        decision = verifier.authorize(
            token, AccessRequest(TENANT, "wardveil.status", "read", "127.0.0.1")
        )
        return decision.allowed is True
    except (ValueError, TypeError, AttributeError):
        return False


def main():
    line = sys.stdin.buffer.readline(32769)
    if not line or len(line) > 32768 or not line.endswith(b"\n"):
        raise SystemExit(2)
    try:
        data = json.loads(line)
        if not isinstance(data, dict):
            raise ValueError("invalid request")
        if data == {"op": "issue"}:
            result = fixture_tokens()
        elif data.get("op") == "verify":
            result = {"allowed": verify(data)}
        else:
            result = {"allowed": False}
    except (ValueError, TypeError, UnicodeError):
        result = {"allowed": False}
    # Emit exactly one machine-readable line with no token diagnostics.
    sys.stdout.write(json.dumps(result, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    main()
