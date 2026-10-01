package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/GoreeCloud/goreecloud-mesh/internal/trust"
)

func TestExactRevision(t *testing.T) {
	valid := strings.Repeat("a", 40)
	if got, err := exactRevision(valid, "test"); err != nil || got != valid {
		t.Fatalf("valid revision rejected: got=%q err=%v", got, err)
	}
	for _, invalid := range []string{strings.Repeat("a", 39), strings.Repeat("A", 40), strings.Repeat("g", 40)} {
		if _, err := exactRevision(invalid, "test"); err == nil {
			t.Fatalf("invalid revision accepted: %q", invalid)
		}
	}
}

func TestReadCredentialRequiresOwnerOnlyRegularFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "token")
	if err := os.WriteFile(path, []byte("header.payload.signature\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := readCredential(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != "header.payload.signature" {
		t.Fatalf("unexpected credential: %q", got)
	}
	if err := os.Chmod(path, 0o640); err != nil {
		t.Fatal(err)
	}
	if _, err := readCredential(path); err == nil {
		t.Fatal("group-readable token file was accepted")
	}
}

func TestNormalizedScopesAndPrincipal(t *testing.T) {
	scopes, err := normalizedScopes([]string{"mesh.evidence.write", "mesh.evidence.read", "mesh.evidence.write"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(scopes, ",") != "mesh.evidence.read,mesh.evidence.write" {
		t.Fatalf("unexpected scopes: %#v", scopes)
	}
	principal := trust.Principal{
		ServiceID: "everkeep",
		Issuer:    trust.DefaultIdentityIssuer,
		Subject:   "service:everkeep",
		Scopes:    []string{"mesh.evidence.read", "mesh.evidence.write"},
	}
	if err := validatePrincipal(principal, "everkeep", scopes); err != nil {
		t.Fatal(err)
	}
	if err := validatePrincipal(principal, "privacy-shield", scopes); err == nil {
		t.Fatal("wrong service identity was accepted")
	}
}

func TestWriteEvidenceIsPrivateAndDoesNotContainCredential(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "evidence.json")
	credential := "header.payload.signature"
	value := evidence{
		Component:                      acceptanceComponent,
		MeshRevision:                   strings.Repeat("a", 40),
		IdentityRevision:               strings.Repeat("b", 40),
		CredentialInEvidence:           false,
		PrivateKeyMaterialInEvidence:   false,
		LiveIdentityVerifierAcceptance: "passed",
		MeshProductionAcceptance:       "unaccepted",
	}
	if err := writeEvidence(path, value, credential); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), credential) {
		t.Fatal("credential leaked into evidence")
	}
	var decoded evidence
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.LiveIdentityVerifierAcceptance != "passed" {
		t.Fatalf("unexpected evidence: %#v", decoded)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("evidence mode = %o, want 600", info.Mode().Perm())
	}

	value.VerifiedSubject = credential
	if err := writeEvidence(path, value, credential); err == nil {
		t.Fatal("credential-bearing evidence was accepted")
	}
}
