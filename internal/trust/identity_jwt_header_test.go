package trust

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIdentityJWTVerifierRejectsAmbiguousProtectedHeaders(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := jwksServer(t, &privateKey.PublicKey, testIdentityKID)
	defer server.Close()
	now := time.Date(2026, 9, 1, 23, 58, 0, 0, time.UTC)
	claims := map[string]any{
		"iss":        "goreecloud-identity",
		"aud":        "goreecloud-mesh",
		"sub":        "service:privacy-shield",
		"service_id": "privacy-shield",
		"scope":      "mesh.evidence.write",
		"iat":        now.Unix(),
		"exp":        now.Add(5 * time.Minute).Unix(),
		"jti":        "header-negative-control",
	}

	cases := map[string]map[string]any{
		"missing-typ": {
			"alg": "RS256", "kid": testIdentityKID,
		},
		"wrong-typ": {
			"alg": "RS256", "typ": "JOSE", "kid": testIdentityKID,
		},
		"critical-extension": {
			"alg": "RS256", "typ": "JWT", "kid": testIdentityKID, "crit": []string{"b64"},
		},
		"jku-key-source": {
			"alg": "RS256", "typ": "JWT", "kid": testIdentityKID, "jku": "https://attacker.invalid/jwks.json",
		},
		"embedded-jwk": {
			"alg": "RS256", "typ": "JWT", "kid": testIdentityKID, "jwk": map[string]any{"kty": "RSA"},
		},
		"x5u-key-source": {
			"alg": "RS256", "typ": "JWT", "kid": testIdentityKID, "x5u": "https://attacker.invalid/cert.pem",
		},
		"x5c-key-source": {
			"alg": "RS256", "typ": "JWT", "kid": testIdentityKID, "x5c": []string{"not-a-trusted-chain"},
		},
	}

	for name, header := range cases {
		t.Run(name, func(t *testing.T) {
			verifier := NewIdentityJWTVerifier(server.URL)
			verifier.Now = func() time.Time { return now }
			token := signTokenWithProtectedHeader(t, privateKey, header, claims)
			req := httptest.NewRequest(http.MethodPost, "/v1/evidence/envelopes", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			if _, err := verifier.Verify(req); err == nil {
				t.Fatal("expected ambiguous Identity JWT header rejection")
			}
		})
	}
}

func signTokenWithProtectedHeader(
	t *testing.T,
	key *rsa.PrivateKey,
	header map[string]any,
	claims map[string]any,
) string {
	t.Helper()
	headerJSON, err := json.Marshal(header)
	if err != nil {
		t.Fatal(err)
	}
	payloadJSON, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	h := base64.RawURLEncoding.EncodeToString(headerJSON)
	p := base64.RawURLEncoding.EncodeToString(payloadJSON)
	digest := sha256.Sum256([]byte(h + "." + p))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return h + "." + p + "." + base64.RawURLEncoding.EncodeToString(signature)
}
