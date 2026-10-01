package trust

import (
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	DefaultIdentityIssuer   = "goreecloud-identity"
	DefaultIdentityAudience = "goreecloud-mesh"
	minimumIdentityRSABytes = 256
	minimumIdentityKIDBytes = 8
	maximumIdentityKIDBytes = 128
)

type IdentityJWTVerifier struct {
	JWKSURL     string
	Issuer      string
	Audience    string
	Client      *http.Client
	ClockSkew   time.Duration
	MaxLifetime time.Duration
	CacheTTL    time.Duration
	Now         func() time.Time

	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

type jwtHeader struct {
	Alg  string          `json:"alg"`
	Kid  string          `json:"kid"`
	Typ  string          `json:"typ,omitempty"`
	Crit []string        `json:"crit,omitempty"`
	JKU  string          `json:"jku,omitempty"`
	JWK  json.RawMessage `json:"jwk,omitempty"`
	X5U  string          `json:"x5u,omitempty"`
	X5C  []string        `json:"x5c,omitempty"`
}

type identityClaims struct {
	Issuer    string          `json:"iss"`
	Audience  json.RawMessage `json:"aud"`
	Subject   string          `json:"sub"`
	ServiceID string          `json:"service_id"`
	Scope     string          `json:"scope"`
	IssuedAt  json.Number     `json:"iat"`
	NotBefore json.Number     `json:"nbf,omitempty"`
	ExpiresAt json.Number     `json:"exp"`
	TokenID   string          `json:"jti"`
}

type jwksDocument struct {
	Keys []jwk `json:"keys"`
}

type jwk struct {
	KTY string `json:"kty"`
	Use string `json:"use,omitempty"`
	Alg string `json:"alg,omitempty"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

func NewIdentityJWTVerifier(jwksURL string) *IdentityJWTVerifier {
	return &IdentityJWTVerifier{
		JWKSURL:     strings.TrimSpace(jwksURL),
		Issuer:      DefaultIdentityIssuer,
		Audience:    DefaultIdentityAudience,
		Client:      &http.Client{Timeout: 5 * time.Second},
		ClockSkew:   time.Minute,
		MaxLifetime: 15 * time.Minute,
		CacheTTL:    5 * time.Minute,
		Now:         time.Now,
	}
}

func (v *IdentityJWTVerifier) Verify(r *http.Request) (Principal, error) {
	if v == nil || strings.TrimSpace(v.JWKSURL) == "" {
		return Principal{}, errors.New("identity JWKS URL is required")
	}
	token, err := bearerToken(r.Header.Get("Authorization"))
	if err != nil {
		return Principal{}, err
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Principal{}, errors.New("identity token must be a compact JWT")
	}

	var header jwtHeader
	if err := decodeJWTPart(parts[0], &header); err != nil {
		return Principal{}, fmt.Errorf("invalid JWT header: %w", err)
	}
	if header.Alg != "RS256" {
		return Principal{}, errors.New("identity token must use RS256")
	}
	if header.Typ != "JWT" {
		return Principal{}, errors.New("identity token typ must be JWT")
	}
	if len(header.Crit) != 0 {
		return Principal{}, errors.New("identity token must not use unsupported critical headers")
	}
	if strings.TrimSpace(header.JKU) != "" || len(header.JWK) != 0 || strings.TrimSpace(header.X5U) != "" || len(header.X5C) != 0 {
		return Principal{}, errors.New("identity token must not select or embed alternate verification keys")
	}
	if !validIdentityKeyID(header.Kid) {
		return Principal{}, errors.New("identity token kid is invalid")
	}

	key, err := v.keyFor(header.Kid, false)
	if err != nil {
		key, err = v.keyFor(header.Kid, true)
		if err != nil {
			return Principal{}, err
		}
	}
	message := []byte(parts[0] + "." + parts[1])
	digest := sha256.Sum256(message)
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Principal{}, errors.New("identity token signature is malformed")
	}
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return Principal{}, errors.New("identity token signature verification failed")
	}

	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return Principal{}, errors.New("identity token claims are malformed")
	}
	decoder := json.NewDecoder(strings.NewReader(string(claimsBytes)))
	decoder.UseNumber()
	var claims identityClaims
	if err := decoder.Decode(&claims); err != nil {
		return Principal{}, errors.New("identity token claims are invalid")
	}
	return v.validateClaims(claims)
}

func (v *IdentityJWTVerifier) validateClaims(c identityClaims) (Principal, error) {
	issuer := strings.TrimSpace(v.Issuer)
	if issuer == "" {
		issuer = DefaultIdentityIssuer
	}
	if strings.TrimSpace(c.Issuer) != issuer {
		return Principal{}, errors.New("identity token issuer is not trusted")
	}
	audience := strings.TrimSpace(v.Audience)
	if audience == "" {
		audience = DefaultIdentityAudience
	}
	if !audienceContains(c.Audience, audience) {
		return Principal{}, errors.New("identity token audience is invalid")
	}

	serviceID := strings.TrimSpace(c.ServiceID)
	if serviceID == "" {
		return Principal{}, errors.New("identity token service_id is required")
	}
	subject := strings.TrimSpace(c.Subject)
	if subject != "service:"+serviceID {
		return Principal{}, errors.New("identity token subject does not match service_id")
	}
	if strings.TrimSpace(c.TokenID) == "" {
		return Principal{}, errors.New("identity token jti is required")
	}

	iat, err := numericDate(c.IssuedAt, "iat", true)
	if err != nil {
		return Principal{}, err
	}
	exp, err := numericDate(c.ExpiresAt, "exp", true)
	if err != nil {
		return Principal{}, err
	}
	var nbf time.Time
	if c.NotBefore != "" {
		nbf, err = numericDate(c.NotBefore, "nbf", false)
		if err != nil {
			return Principal{}, err
		}
	}
	if !exp.After(iat) {
		return Principal{}, errors.New("identity token exp must be after iat")
	}
	maxLifetime := v.MaxLifetime
	if maxLifetime <= 0 {
		maxLifetime = 15 * time.Minute
	}
	if exp.Sub(iat) > maxLifetime {
		return Principal{}, errors.New("identity token lifetime exceeds maximum")
	}

	nowFn := v.Now
	if nowFn == nil {
		nowFn = time.Now
	}
	now := nowFn().UTC()
	skew := v.ClockSkew
	if skew < 0 {
		skew = 0
	}
	if now.After(exp.Add(skew)) {
		return Principal{}, errors.New("identity token is expired")
	}
	if iat.After(now.Add(skew)) {
		return Principal{}, errors.New("identity token was issued in the future")
	}
	if !nbf.IsZero() && nbf.After(now.Add(skew)) {
		return Principal{}, errors.New("identity token is not yet valid")
	}

	scopes := strings.Fields(c.Scope)
	if len(scopes) == 0 {
		return Principal{}, errors.New("identity token scope is required")
	}
	principal := Principal{ServiceID: serviceID, Issuer: issuer, Subject: subject, Scopes: scopes}
	if err := Validate(principal); err != nil {
		return Principal{}, err
	}
	return normalize(principal), nil
}

func bearerToken(value string) (string, error) {
	parts := strings.Fields(value)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
		return "", errors.New("bearer identity credential is required")
	}
	return parts[1], nil
}

func decodeJWTPart(part string, out any) error {
	decoded, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil {
		return err
	}
	return json.Unmarshal(decoded, out)
}

func numericDate(value json.Number, name string, required bool) (time.Time, error) {
	if value == "" {
		if required {
			return time.Time{}, fmt.Errorf("identity token %s is required", name)
		}
		return time.Time{}, nil
	}
	seconds, err := value.Int64()
	if err != nil || seconds <= 0 {
		return time.Time{}, fmt.Errorf("identity token %s is invalid", name)
	}
	return time.Unix(seconds, 0).UTC(), nil
}

func audienceContains(raw json.RawMessage, expected string) bool {
	if len(raw) == 0 {
		return false
	}
	var single string
	if json.Unmarshal(raw, &single) == nil {
		return single == expected
	}
	var many []string
	if json.Unmarshal(raw, &many) != nil {
		return false
	}
	for _, item := range many {
		if item == expected {
			return true
		}
	}
	return false
}

func (v *IdentityJWTVerifier) keyFor(kid string, force bool) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	now := time.Now().UTC()
	cacheTTL := v.CacheTTL
	if cacheTTL <= 0 {
		cacheTTL = 5 * time.Minute
	}
	if !force && v.keys != nil && now.Sub(v.fetchedAt) < cacheTTL {
		if key := v.keys[kid]; key != nil {
			return key, nil
		}
	}
	if err := v.refreshKeysLocked(); err != nil {
		return nil, err
	}
	if key := v.keys[kid]; key != nil {
		return key, nil
	}
	return nil, errors.New("identity token signing key is unknown")
}

func (v *IdentityJWTVerifier) refreshKeysLocked() error {
	jwksURL, err := validateIdentityJWKSURL(v.JWKSURL)
	if err != nil {
		return err
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	req, err := http.NewRequest(http.MethodGet, jwksURL, nil)
	if err != nil {
		return errors.New("identity JWKS URL is invalid")
	}
	req.Header.Set("Accept", "application/json")
	resp, err := clientCopy.Do(req)
	if err != nil {
		return errors.New("identity JWKS retrieval failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("identity JWKS retrieval returned HTTP %d", resp.StatusCode)
	}
	mediaType, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errors.New("identity JWKS response must use application/json")
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return errors.New("identity JWKS response could not be read")
	}
	var doc jwksDocument
	if err := json.Unmarshal(body, &doc); err != nil {
		return errors.New("identity JWKS response is invalid")
	}
	keys := make(map[string]*rsa.PublicKey)
	for _, item := range doc.Keys {
		if item.KTY != "RSA" || !validIdentityKeyID(item.Kid) || item.N == "" || item.E == "" {
			continue
		}
		if item.Alg != "" && item.Alg != "RS256" {
			continue
		}
		if item.Use != "" && item.Use != "sig" {
			continue
		}
		key, err := rsaKey(item.N, item.E)
		if err != nil {
			continue
		}
		if _, exists := keys[item.Kid]; exists {
			return errors.New("identity JWKS contains a duplicate signing key id")
		}
		keys[item.Kid] = key
	}
	if len(keys) == 0 {
		return errors.New("identity JWKS contains no usable RS256 keys")
	}
	v.keys = keys
	v.fetchedAt = time.Now().UTC()
	return nil
}

func validateIdentityJWKSURL(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Hostname() == "" {
		return "", errors.New("identity JWKS URL is invalid")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("identity JWKS URL must not contain credentials, query, or fragment")
	}
	if parsed.Scheme == "https" {
		return parsed.String(), nil
	}
	if parsed.Scheme != "http" || !isLoopbackHostname(parsed.Hostname()) {
		return "", errors.New("identity JWKS URL must use HTTPS except for loopback testing")
	}
	return parsed.String(), nil
}

func isLoopbackHostname(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func validIdentityKeyID(kid string) bool {
	if len(kid) < minimumIdentityKIDBytes || len(kid) > maximumIdentityKIDBytes {
		return false
	}
	for _, char := range kid {
		if (char >= 'A' && char <= 'Z') ||
			(char >= 'a' && char <= 'z') ||
			(char >= '0' && char <= '9') ||
			char == '.' || char == '_' || char == '-' {
			continue
		}
		return false
	}
	return true
}

func rsaKey(nEncoded, eEncoded string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(nEncoded)
	if err != nil || len(nBytes) < minimumIdentityRSABytes {
		return nil, errors.New("invalid or weak RSA modulus")
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(eEncoded)
	if err != nil || len(eBytes) == 0 || len(eBytes) > 4 {
		return nil, errors.New("invalid RSA exponent")
	}
	e := 0
	for _, b := range eBytes {
		e = e<<8 | int(b)
	}
	if e < 3 || e%2 == 0 {
		return nil, errors.New("invalid RSA exponent")
	}
	key := &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: e}
	if key.N.BitLen() < minimumIdentityRSABytes*8 {
		return nil, errors.New("invalid or weak RSA modulus")
	}
	return key, nil
}
