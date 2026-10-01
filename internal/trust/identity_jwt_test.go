package trust

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

const testIdentityKID = "mesh-kid-1"

func TestIdentityJWTVerifierAcceptsValidServiceToken(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := jwksServer(t, &privateKey.PublicKey, testIdentityKID)
	defer server.Close()
	now := time.Date(2026, 8, 26, 20, 0, 0, 0, time.UTC)
	verifier := NewIdentityJWTVerifier(server.URL)
	verifier.Now = func() time.Time { return now }
	claims := map[string]any{
		"iss": "goreecloud-identity", "aud": "goreecloud-mesh",
		"sub": "service:wardveil-security", "service_id": "wardveil-security",
		"scope": "mesh.evidence.write mesh.evidence.read", "iat": now.Unix(),
		"nbf": now.Add(-time.Second).Unix(), "exp": now.Add(10 * time.Minute).Unix(), "jti": "token-001",
	}
	token := signToken(t, privateKey, testIdentityKID, claims)
	req := httptest.NewRequest(http.MethodPost, "/v1/evidence/envelopes", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	principal, err := verifier.Verify(req)
	if err != nil {
		t.Fatal(err)
	}
	if principal.ServiceID != "wardveil-security" || principal.Issuer != "goreecloud-identity" || !HasScope(principal, "mesh.evidence.write") {
		t.Fatalf("unexpected principal: %#v", principal)
	}
}

func TestIdentityJWTVerifierRejectsWrongAudienceAndLongLifetime(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := jwksServer(t, &privateKey.PublicKey, testIdentityKID)
	defer server.Close()
	now := time.Now().UTC().Truncate(time.Second)
	verifier := NewIdentityJWTVerifier(server.URL)
	verifier.Now = func() time.Time { return now }
	base := map[string]any{"iss": "goreecloud-identity", "aud": "wrong", "sub": "service:everkeep", "service_id": "everkeep", "scope": "mesh.evidence.write", "iat": now.Unix(), "exp": now.Add(10 * time.Minute).Unix(), "jti": "t1"}
	for name, mutate := range map[string]func(map[string]any){
		"audience": func(c map[string]any) {},
		"lifetime": func(c map[string]any) { c["aud"] = "goreecloud-mesh"; c["exp"] = now.Add(20 * time.Minute).Unix() },
	} {
		t.Run(name, func(t *testing.T) {
			claims := map[string]any{}
			for k, v := range base {
				claims[k] = v
			}
			mutate(claims)
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.Header.Set("Authorization", "Bearer "+signToken(t, privateKey, testIdentityKID, claims))
			if _, err := verifier.Verify(req); err == nil {
				t.Fatal("expected verification failure")
			}
		})
	}
}

func TestIdentityJWTVerifierRejectsServiceSubjectMismatch(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := jwksServer(t, &privateKey.PublicKey, testIdentityKID)
	defer server.Close()
	now := time.Now().UTC().Truncate(time.Second)
	verifier := NewIdentityJWTVerifier(server.URL)
	verifier.Now = func() time.Time { return now }
	claims := map[string]any{"iss": "goreecloud-identity", "aud": "goreecloud-mesh", "sub": "service:privacy-shield", "service_id": "wardveil-security", "scope": "mesh.evidence.write", "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(), "jti": "t2"}
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+signToken(t, privateKey, testIdentityKID, claims))
	if _, err := verifier.Verify(req); err == nil {
		t.Fatal("expected subject/service mismatch rejection")
	}
}

func TestIdentityJWTVerifierRejectsInvalidTokenKID(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	server := jwksServer(t, &privateKey.PublicKey, testIdentityKID)
	defer server.Close()
	now := time.Now().UTC().Truncate(time.Second)
	claims := map[string]any{"iss": "goreecloud-identity", "aud": "goreecloud-mesh", "sub": "service:everkeep", "service_id": "everkeep", "scope": "mesh.evidence.write", "iat": now.Unix(), "exp": now.Add(5 * time.Minute).Unix(), "jti": "t-kid"}
	for _, kid := range []string{"short", "invalid kid", strings.Repeat("a", 129)} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set("Authorization", "Bearer "+signToken(t, privateKey, kid, claims))
		if _, err := NewIdentityJWTVerifier(server.URL).Verify(req); err == nil || !strings.Contains(err.Error(), "kid is invalid") {
			t.Fatalf("expected invalid kid rejection for %q, got %v", kid, err)
		}
	}
}

func TestIdentityJWTVerifierRejectsUnsafeJWKSSources(t *testing.T) {
	for name, raw := range map[string]string{
		"plain-http":  "http://identity.example/.well-known/jwks.json",
		"credentials": "https://user:secret@identity.example/.well-known/jwks.json",
		"query":       "https://identity.example/.well-known/jwks.json?source=other",
		"fragment":    "https://identity.example/.well-known/jwks.json#other",
	} {
		t.Run(name, func(t *testing.T) {
			verifier := NewIdentityJWTVerifier(raw)
			if err := verifier.refreshKeysLocked(); err == nil {
				t.Fatal("expected unsafe JWKS source rejection")
			}
		})
	}
}

func TestIdentityJWTVerifierRefusesJWKSSourceRedirect(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	target := jwksServer(t, &privateKey.PublicKey, "kid-target")
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusFound)
	}))
	defer redirect.Close()

	verifier := NewIdentityJWTVerifier(redirect.URL)
	err = verifier.refreshKeysLocked()
	if err == nil || !strings.Contains(err.Error(), "HTTP 302") {
		t.Fatalf("expected redirect refusal, got %v", err)
	}
}

func TestIdentityJWKSRejectsNonJSONResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte(`{"keys":[]}`))
	}))
	defer server.Close()
	verifier := NewIdentityJWTVerifier(server.URL)
	if err := verifier.refreshKeysLocked(); err == nil || !strings.Contains(err.Error(), "application/json") {
		t.Fatalf("expected non-JSON JWKS rejection, got %v", err)
	}
}

func TestIdentityJWKSRejectsWeakDuplicateInvalidKIDAndEvenExponentKeys(t *testing.T) {
	weak, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := rsaKey(
		base64.RawURLEncoding.EncodeToString(weak.PublicKey.N.Bytes()),
		base64.RawURLEncoding.EncodeToString(big.NewInt(int64(weak.PublicKey.E)).Bytes()),
	); err == nil {
		t.Fatal("expected weak Identity RSA key rejection")
	}

	strong, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	item := jwkMap(&strong.PublicKey, "duplicate-kid")
	server := jwksDocumentServer(t, []map[string]any{item, item})
	defer server.Close()
	verifier := NewIdentityJWTVerifier(server.URL)
	if err := verifier.refreshKeysLocked(); err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("expected duplicate kid rejection, got %v", err)
	}

	invalidKID := jwkMap(&strong.PublicKey, "short")
	invalidServer := jwksDocumentServer(t, []map[string]any{invalidKID})
	defer invalidServer.Close()
	if err := NewIdentityJWTVerifier(invalidServer.URL).refreshKeysLocked(); err == nil || !strings.Contains(err.Error(), "no usable") {
		t.Fatalf("expected invalid JWKS kid rejection, got %v", err)
	}

	evenExponent := base64.RawURLEncoding.EncodeToString(big.NewInt(4).Bytes())
	if _, err := rsaKey(
		base64.RawURLEncoding.EncodeToString(strong.PublicKey.N.Bytes()),
		evenExponent,
	); err == nil {
		t.Fatal("expected even RSA exponent rejection")
	}
}

func jwksServer(t *testing.T, publicKey *rsa.PublicKey, kid string) *httptest.Server {
	t.Helper()
	return jwksDocumentServer(t, []map[string]any{jwkMap(publicKey, kid)})
}

func jwksDocumentServer(t *testing.T, keys []map[string]any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": keys})
	}))
}

func jwkMap(publicKey *rsa.PublicKey, kid string) map[string]any {
	n := base64.RawURLEncoding.EncodeToString(publicKey.N.Bytes())
	e := big.NewInt(int64(publicKey.E)).Bytes()
	eEncoded := base64.RawURLEncoding.EncodeToString(e)
	return map[string]any{
		"kty": "RSA",
		"use": "sig",
		"alg": "RS256",
		"kid": kid,
		"n":   n,
		"e":   eEncoded,
	}
}

func signToken(t *testing.T, key *rsa.PrivateKey, kid string, claims map[string]any) string {
	t.Helper()
	header, _ := json.Marshal(map[string]any{"alg": "RS256", "typ": "JWT", "kid": kid})
	payload, _ := json.Marshal(claims)
	h := base64.RawURLEncoding.EncodeToString(header)
	p := base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(h + "." + p))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return h + "." + p + "." + base64.RawURLEncoding.EncodeToString(sig)
}
