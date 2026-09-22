package contracts

import (
	"strings"
	"testing"
	"time"
)

func validEnvelope(now time.Time) EvidenceEnvelope {
	return EvidenceEnvelope{
		Version: EvidenceEnvelopeVersion,
		ID:      "wardveil-runtime-acceptance-001",
		Producer: EvidenceEnvelopeProducer{
			System:     WardveilProducer,
			Repository: "GoreeCloud/goreecloud-wardveil-security",
			Revision:   strings.Repeat("a", 40),
			Contract:   "contracts/wardveil.runtime-acceptance.schema.json",
		},
		AuthorityDomain: "security",
		Subject: EvidenceEnvelopeSubject{
			Kind:  "service",
			ID:    "wardveil-security",
			Scope: "cloudflare-runtime",
		},
		Assertion:              "runtime-acceptance",
		Outcome:                "validated",
		Source:                 "wardveil://runtime-evidence/acceptance-001",
		ObservedAt:             now.Add(-5 * time.Minute),
		ValidUntil:             now.Add(55 * time.Minute),
		DataClass:              EvidenceOperational,
		Summary:                "Bounded producer-authoritative runtime acceptance evidence.",
		PayloadDigest:          "sha256:" + strings.Repeat("b", 64),
		ContainsUserContent:    false,
		ContainsSecretMaterial: false,
	}
}

func TestNormalizeEvidenceEnvelopeAcceptsCanonicalProducerEvidence(t *testing.T) {
	now := time.Date(2026, time.August, 26, 22, 30, 0, 0, time.UTC)
	got, err := normalizeEvidenceEnvelopeAt(validEnvelope(now), now)
	if err != nil {
		t.Fatalf("expected valid evidence envelope: %v", err)
	}
	if got.Producer.System != WardveilProducer || got.AuthorityDomain != "security" {
		t.Fatalf("unexpected normalized envelope: %#v", got)
	}
	if !got.FreshAt(now) {
		t.Fatal("expected normalized evidence envelope to be fresh")
	}
}

func TestNormalizeEvidenceEnvelopeAcceptsIdentityAuthorityWithoutCrossDomainEscalation(t *testing.T) {
	now := time.Date(2026, time.August, 29, 12, 30, 0, 0, time.UTC)
	v := validEnvelope(now)
	v.ID = "identity-authentication-result-001"
	v.Producer = EvidenceEnvelopeProducer{
		System:     IdentityProducer,
		Repository: "GoreeCloud/goreecloud-identity",
		Revision:   strings.Repeat("d", 40),
		Contract:   "contracts/identity.evidence.schema.json",
	}
	v.AuthorityDomain = "authentication"
	v.Subject = EvidenceEnvelopeSubject{Kind: "service", ID: "goreecloud-drive", Scope: "mesh-delivery"}
	v.Assertion = "authentication-result"
	v.Outcome = "verified"
	v.Source = "identity://evidence/authentication-result-001"
	v.Summary = "Minimized Identity authentication evidence; no reusable credential or session secret is transported."

	got, err := normalizeEvidenceEnvelopeAt(v, now)
	if err != nil {
		t.Fatalf("expected bounded Identity evidence to be valid: %v", err)
	}
	if got.Producer.System != IdentityProducer || got.AuthorityDomain != "authentication" {
		t.Fatalf("unexpected Identity evidence envelope: %#v", got)
	}

	v.AuthorityDomain = "security"
	if _, err := normalizeEvidenceEnvelopeAt(v, now); err == nil {
		t.Fatal("expected Identity producer to be unable to assert Wardveil security authority")
	}
}

func TestNormalizeEvidenceEnvelopeRejectsRepositoryMismatch(t *testing.T) {
	now := time.Date(2026, time.August, 26, 22, 30, 0, 0, time.UTC)
	v := validEnvelope(now)
	v.Producer.Repository = "GoreeCloud/goreecloud-everkeep"
	if _, err := normalizeEvidenceEnvelopeAt(v, now); err == nil {
		t.Fatal("expected canonical producer repository mismatch to fail")
	}
}

func TestNormalizeEvidenceEnvelopeRejectsAuthorityEscalation(t *testing.T) {
	now := time.Date(2026, time.August, 26, 22, 30, 0, 0, time.UTC)
	v := validEnvelope(now)
	v.AuthorityDomain = "privacy"
	if _, err := normalizeEvidenceEnvelopeAt(v, now); err == nil {
		t.Fatal("expected producer authority-domain escalation to fail")
	}
}

func TestNormalizeEvidenceEnvelopeRejectsRawUserContentAndSecrets(t *testing.T) {
	now := time.Date(2026, time.August, 26, 22, 30, 0, 0, time.UTC)
	for name, mutate := range map[string]func(*EvidenceEnvelope){
		"user content":    func(v *EvidenceEnvelope) { v.ContainsUserContent = true },
		"secret material": func(v *EvidenceEnvelope) { v.ContainsSecretMaterial = true },
	} {
		t.Run(name, func(t *testing.T) {
			v := validEnvelope(now)
			mutate(&v)
			if _, err := normalizeEvidenceEnvelopeAt(v, now); err == nil {
				t.Fatalf("expected %s to be rejected", name)
			}
		})
	}
}

func TestNormalizeEvidenceEnvelopeRejectsExpiredOrFutureEvidence(t *testing.T) {
	now := time.Date(2026, time.August, 26, 22, 30, 0, 0, time.UTC)

	expired := validEnvelope(now)
	expired.ObservedAt = now.Add(-2 * time.Hour)
	expired.ValidUntil = now.Add(-time.Hour)
	if _, err := normalizeEvidenceEnvelopeAt(expired, now); err == nil {
		t.Fatal("expected expired evidence to fail")
	}

	future := validEnvelope(now)
	future.ObservedAt = now.Add(time.Minute)
	future.ValidUntil = now.Add(time.Hour)
	if _, err := normalizeEvidenceEnvelopeAt(future, now); err == nil {
		t.Fatal("expected future observation time to fail")
	}
}

func TestNormalizeEvidenceEnvelopeAllowsMeshGovernanceEvidenceWithoutMakingMeshMandatory(t *testing.T) {
	now := time.Date(2026, time.August, 26, 22, 30, 0, 0, time.UTC)
	v := validEnvelope(now)
	v.ID = "mesh-governance-001"
	v.Producer = EvidenceEnvelopeProducer{
		System:     MeshProducer,
		Repository: "GoreeCloud/mesh",
		Revision:   strings.Repeat("c", 40),
		Contract:   "contracts/mesh.evidence-envelope.schema.json",
	}
	v.AuthorityDomain = "governance"
	v.Subject = EvidenceEnvelopeSubject{Kind: "contract", ID: EvidenceEnvelopeVersion}
	v.Assertion = "envelope-validation"
	v.Outcome = "validated"
	v.Source = "mesh://contracts/evidence-envelope"
	if _, err := normalizeEvidenceEnvelopeAt(v, now); err != nil {
		t.Fatalf("expected Mesh governance evidence to be valid: %v", err)
	}
	if IsMandatory(Platform(MeshProducer)) {
		t.Fatal("Mesh evidence producer must not silently become a mandatory integral-platform acceptance entry")
	}
}

func TestNormalizeEvidenceEnvelopeRejectsStaleMeshRepositoryIdentity(t *testing.T) {
	now := time.Date(2026, time.September, 22, 20, 40, 0, 0, time.UTC)
	v := validEnvelope(now)
	v.ID = "mesh-governance-stale-repository-001"
	v.Producer = EvidenceEnvelopeProducer{
		System:     MeshProducer,
		Repository: "GoreeCloud/goreecloud-mesh",
		Revision:   strings.Repeat("c", 40),
		Contract:   "contracts/mesh.evidence-envelope.schema.json",
	}
	v.AuthorityDomain = "governance"
	v.Subject = EvidenceEnvelopeSubject{Kind: "contract", ID: EvidenceEnvelopeVersion}
	v.Assertion = "envelope-validation"
	v.Outcome = "validated"
	v.Source = "mesh://contracts/evidence-envelope"
	if _, err := normalizeEvidenceEnvelopeAt(v, now); err == nil {
		t.Fatal("expected stale pre-canonical Mesh repository provenance to fail closed")
	}
}
