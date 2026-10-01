package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/GoreeCloud/goreecloud-mesh/internal/trust"
)

const (
	acceptanceComponent = "GoreeCloud Mesh live Identity verifier acceptance"
	maxTokenBytes       = 16 * 1024
)

type scopeFlags []string

func (s *scopeFlags) String() string { return strings.Join(*s, ",") }
func (s *scopeFlags) Set(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return errors.New("required scope must not be empty")
	}
	*s = append(*s, value)
	return nil
}

type evidence struct {
	Component                            string   `json:"component"`
	ObservedAt                           string   `json:"observed_at"`
	MeshRevision                         string   `json:"mesh_revision"`
	IdentityRevision                     string   `json:"identity_revision"`
	JWKSURL                              string   `json:"jwks_url"`
	ExpectedIssuer                       string   `json:"expected_issuer"`
	ExpectedAudience                     string   `json:"expected_audience"`
	ExpectedServiceID                    string   `json:"expected_service_id"`
	RequiredScopes                       []string `json:"required_scopes"`
	VerifiedServiceID                    string   `json:"verified_service_id"`
	VerifiedSubject                      string   `json:"verified_subject"`
	VerifiedScopes                       []string `json:"verified_scopes"`
	CredentialSHA256                     string   `json:"credential_sha256"`
	DeployedJWKSAndSignatureVerification string   `json:"deployed_jwks_and_signature_verification"`
	IssuerAudienceValidation             string   `json:"issuer_audience_validation"`
	ServiceSubjectBinding                string   `json:"service_subject_binding"`
	RequiredScopeValidation              string   `json:"required_scope_validation"`
	UnauthenticatedRequestRejection      string   `json:"unauthenticated_request_rejection"`
	CredentialInEvidence                 bool     `json:"credential_in_evidence"`
	PrivateKeyMaterialInEvidence         bool     `json:"private_key_material_in_evidence"`
	LiveIdentityVerifierAcceptance       string   `json:"live_identity_verifier_acceptance"`
	IdentityProductionAcceptance         string   `json:"identity_production_acceptance"`
	MeshProductionAcceptance             string   `json:"mesh_production_acceptance"`
}

func exactRevision(value, name string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) != 40 {
		return "", fmt.Errorf("%s must be an exact lowercase 40-character Git SHA", name)
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return "", fmt.Errorf("%s must be an exact lowercase 40-character Git SHA", name)
		}
	}
	return value, nil
}

func readCredential(path string) (string, error) {
	clean := filepath.Clean(strings.TrimSpace(path))
	if clean == "." || !filepath.IsAbs(clean) {
		return "", errors.New("token file must be an absolute path")
	}
	info, err := os.Lstat(clean)
	if err != nil {
		return "", fmt.Errorf("read token metadata: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", errors.New("token file must be a regular non-symlink file")
	}
	if info.Mode().Perm()&0o077 != 0 {
		return "", errors.New("token file must not be accessible to group or other users")
	}
	raw, err := os.ReadFile(clean)
	if err != nil {
		return "", fmt.Errorf("read token file: %w", err)
	}
	if len(raw) == 0 || len(raw) > maxTokenBytes {
		return "", errors.New("token file length is outside the acceptance bound")
	}
	token := strings.TrimSpace(string(raw))
	if token == "" || strings.ContainsAny(token, "\r\n\t ") {
		return "", errors.New("token file must contain exactly one compact credential")
	}
	return token, nil
}

func normalizedScopes(values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, errors.New("at least one --required-scope is required")
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, errors.New("required scope must not be empty")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	sort.Strings(out)
	return out, nil
}

func validatePrincipal(principal trust.Principal, serviceID string, scopes []string) error {
	if principal.Issuer != trust.DefaultIdentityIssuer {
		return errors.New("verified Identity issuer does not match GoreeCloud Identity")
	}
	if principal.ServiceID != serviceID {
		return errors.New("verified service_id does not match acceptance target")
	}
	if principal.Subject != "service:"+serviceID {
		return errors.New("verified subject does not match service_id")
	}
	for _, scope := range scopes {
		if !trust.HasScope(principal, scope) {
			return fmt.Errorf("verified credential is missing required scope %q", scope)
		}
	}
	return nil
}

func writeEvidence(path string, value evidence, credential string) error {
	clean := filepath.Clean(strings.TrimSpace(path))
	if clean == "." || !filepath.IsAbs(clean) {
		return errors.New("output path must be absolute")
	}
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	if credential != "" && strings.Contains(string(raw), credential) {
		return errors.New("credential would leak into acceptance evidence")
	}
	if err := os.MkdirAll(filepath.Dir(clean), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(clean), ".mesh-identity-acceptance-*")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(raw); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryName, clean); err != nil {
		return err
	}
	return os.Chmod(clean, 0o600)
}

func run() error {
	var requiredScopes scopeFlags
	jwksURL := flag.String("jwks-url", "", "deployed GoreeCloud Identity JWKS HTTPS URL")
	tokenFile := flag.String("token-file", "", "absolute owner-only file containing a live Identity service JWT")
	serviceID := flag.String("service-id", "", "expected service_id in the live Identity credential")
	meshRevisionRaw := flag.String("mesh-revision", "", "exact GoreeCloud Mesh revision under acceptance")
	identityRevisionRaw := flag.String("identity-revision", "", "exact GoreeCloud Identity revision that issued/published the credential and JWKS")
	output := flag.String("output", "", "absolute path for sanitized mode-0600 evidence")
	flag.Var(&requiredScopes, "required-scope", "required Mesh scope; repeat for multiple scopes")
	flag.Parse()

	meshRevision, err := exactRevision(*meshRevisionRaw, "mesh revision")
	if err != nil {
		return err
	}
	identityRevision, err := exactRevision(*identityRevisionRaw, "identity revision")
	if err != nil {
		return err
	}
	service := strings.TrimSpace(*serviceID)
	if service == "" {
		return errors.New("service-id is required")
	}
	scopes, err := normalizedScopes(requiredScopes)
	if err != nil {
		return err
	}
	credential, err := readCredential(*tokenFile)
	if err != nil {
		return err
	}

	verifier := trust.NewIdentityJWTVerifier(*jwksURL)
	request, err := http.NewRequest(http.MethodGet, "http://mesh.acceptance.invalid/identity", nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+credential)
	principal, err := verifier.Verify(request)
	if err != nil {
		return fmt.Errorf("live Identity credential verification failed: %w", err)
	}
	if err := validatePrincipal(principal, service, scopes); err != nil {
		return err
	}

	unauthenticated, err := http.NewRequest(http.MethodGet, "http://mesh.acceptance.invalid/identity", nil)
	if err != nil {
		return err
	}
	if _, err := verifier.Verify(unauthenticated); err == nil {
		return errors.New("Identity verifier accepted a request without a bearer credential")
	}

	digest := sha256.Sum256([]byte(credential))
	result := evidence{
		Component:                            acceptanceComponent,
		ObservedAt:                           time.Now().UTC().Format(time.RFC3339Nano),
		MeshRevision:                         meshRevision,
		IdentityRevision:                     identityRevision,
		JWKSURL:                              strings.TrimSpace(*jwksURL),
		ExpectedIssuer:                       trust.DefaultIdentityIssuer,
		ExpectedAudience:                     trust.DefaultIdentityAudience,
		ExpectedServiceID:                    service,
		RequiredScopes:                       scopes,
		VerifiedServiceID:                    principal.ServiceID,
		VerifiedSubject:                      principal.Subject,
		VerifiedScopes:                       principal.Scopes,
		CredentialSHA256:                     hex.EncodeToString(digest[:]),
		DeployedJWKSAndSignatureVerification: "passed",
		IssuerAudienceValidation:             "passed",
		ServiceSubjectBinding:                "passed",
		RequiredScopeValidation:              "passed",
		UnauthenticatedRequestRejection:      "passed",
		CredentialInEvidence:                 false,
		PrivateKeyMaterialInEvidence:         false,
		LiveIdentityVerifierAcceptance:       "passed",
		IdentityProductionAcceptance:         "not_established_by_mesh_acceptance",
		MeshProductionAcceptance:             "unaccepted",
	}
	if err := writeEvidence(*output, result, credential); err != nil {
		return err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	fmt.Println(string(encoded))
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Mesh Identity acceptance failed:", err)
		os.Exit(1)
	}
}
