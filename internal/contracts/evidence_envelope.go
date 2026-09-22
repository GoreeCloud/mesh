package contracts

import (
	"errors"
	"regexp"
	"strings"
	"time"
)

// EvidenceEnvelopeVersion is the first GoreeCloud-wide transport envelope for
// bounded, producer-authoritative evidence. Mesh validates transport and
// provenance invariants without reinterpreting the producer's domain truth.
const EvidenceEnvelopeVersion = "goreecloud.evidence-envelope.v1"

type EvidenceProducerID string

const (
	MeshProducer          EvidenceProducerID = "goreecloud-mesh"
	IdentityProducer      EvidenceProducerID = "goreecloud-identity"
	GlazeUIProducer       EvidenceProducerID = "glaze-ui"
	WardveilProducer      EvidenceProducerID = "wardveil-security"
	PrivacyShieldProducer EvidenceProducerID = "privacy-shield"
	EverkeepProducer      EvidenceProducerID = "everkeep"
)

type EvidenceDataClass string

const (
	EvidencePublic      EvidenceDataClass = "public"
	EvidenceOperational EvidenceDataClass = "operational"
	EvidenceDerived     EvidenceDataClass = "derived"
)

type EvidenceEnvelopeProducer struct {
	System     EvidenceProducerID `json:"system"`
	Repository string             `json:"repository"`
	Revision   string             `json:"revision"`
	Contract   string             `json:"contract"`
}

type EvidenceEnvelopeSubject struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Scope string `json:"scope,omitempty"`
}

type EvidenceEnvelope struct {
	Version                string                   `json:"version"`
	ID                     string                   `json:"id"`
	Producer               EvidenceEnvelopeProducer `json:"producer"`
	AuthorityDomain        string                   `json:"authority_domain"`
	Subject                EvidenceEnvelopeSubject  `json:"subject"`
	Assertion              string                   `json:"assertion"`
	Outcome                string                   `json:"outcome"`
	Source                 string                   `json:"source"`
	ObservedAt             time.Time                `json:"observed_at"`
	ValidUntil             time.Time                `json:"valid_until"`
	DataClass              EvidenceDataClass        `json:"data_class"`
	Summary                string                   `json:"summary,omitempty"`
	PayloadDigest          string                   `json:"payload_digest,omitempty"`
	ContainsUserContent    bool                     `json:"contains_user_content"`
	ContainsSecretMaterial bool                     `json:"contains_secret_material"`
}

var evidenceDigestPattern = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

var evidenceProducerRepositories = map[EvidenceProducerID]string{
	MeshProducer:          "GoreeCloud/mesh",
	IdentityProducer:      "GoreeCloud/goreecloud-identity",
	GlazeUIProducer:       "GoreeCloud/goreecloud-glaze-ui",
	WardveilProducer:      "GoreeCloud/goreecloud-wardveil-security",
	PrivacyShieldProducer: "GoreeCloud/goreecloud-privacy-shield",
	EverkeepProducer:      "GoreeCloud/goreecloud-everkeep",
}

var evidenceAuthorityDomains = map[EvidenceProducerID]map[string]bool{
	MeshProducer:          {"coordination": true, "governance": true},
	IdentityProducer:      {"identity": true, "authentication": true, "authorization": true, "accounts": true, "devices": true, "credentials": true, "sessions": true, "delegated-authority": true},
	GlazeUIProducer:       {"presentation": true, "design-conformance": true},
	WardveilProducer:      {"security": true},
	PrivacyShieldProducer: {"privacy": true},
	EverkeepProducer:      {"resilience": true, "recovery": true, "preservation": true, "continuity": true},
}

var evidenceProducerContractPrefixes = map[EvidenceProducerID][]string{
	MeshProducer:          {"contracts/mesh."},
	IdentityProducer:      {"contracts/identity."},
	WardveilProducer:      {"contracts/wardveil."},
	PrivacyShieldProducer: {"contracts/privacy-shield."},
	EverkeepProducer:      {"contracts/everkeep."},
}

var glazeEvidenceContracts = map[string]bool{
	"CONFORMANCE.md":                    true,
	"EVIDENCE_PRESENTATION.md":          true,
	"tokens/enforcement.json":           true,
	"tokens/evidence-presentation.json": true,
}

func NormalizeEvidenceEnvelope(v EvidenceEnvelope) (EvidenceEnvelope, error) {
	return normalizeEvidenceEnvelopeAt(v, time.Now().UTC())
}

func normalizeEvidenceEnvelopeAt(v EvidenceEnvelope, evaluatedAt time.Time) (EvidenceEnvelope, error) {
	return normalizeEvidenceEnvelope(v, evaluatedAt, true)
}

// normalizeStoredEvidenceEnvelope validates durable evidence without requiring
// it to still be fresh. Expiration is a normal lifecycle state and must not
// prevent Mesh from restarting or retaining historical provenance.
func normalizeStoredEvidenceEnvelope(v EvidenceEnvelope, evaluatedAt time.Time) (EvidenceEnvelope, error) {
	return normalizeEvidenceEnvelope(v, evaluatedAt, false)
}

func normalizeEvidenceEnvelope(v EvidenceEnvelope, evaluatedAt time.Time, requireFresh bool) (EvidenceEnvelope, error) {
	v.Version = strings.TrimSpace(v.Version)
	v.ID = strings.TrimSpace(v.ID)
	v.Producer.Repository = strings.TrimSpace(v.Producer.Repository)
	v.Producer.Revision = strings.TrimSpace(v.Producer.Revision)
	v.Producer.Contract = strings.TrimSpace(v.Producer.Contract)
	v.AuthorityDomain = strings.TrimSpace(v.AuthorityDomain)
	v.Subject.Kind = strings.TrimSpace(v.Subject.Kind)
	v.Subject.ID = strings.TrimSpace(v.Subject.ID)
	v.Subject.Scope = strings.TrimSpace(v.Subject.Scope)
	v.Assertion = strings.TrimSpace(v.Assertion)
	v.Outcome = strings.TrimSpace(v.Outcome)
	v.Source = strings.TrimSpace(v.Source)
	v.Summary = strings.TrimSpace(v.Summary)
	v.PayloadDigest = strings.TrimSpace(v.PayloadDigest)
	evaluatedAt = evaluatedAt.UTC()

	if v.Version != EvidenceEnvelopeVersion {
		return EvidenceEnvelope{}, errors.New("unsupported evidence envelope version")
	}
	if v.ID == "" || len(v.ID) > 128 {
		return EvidenceEnvelope{}, errors.New("evidence envelope id is required and must be at most 128 characters")
	}
	canonicalRepository, ok := evidenceProducerRepositories[v.Producer.System]
	if !ok {
		return EvidenceEnvelope{}, errors.New("unknown evidence producer")
	}
	if v.Producer.Repository != canonicalRepository {
		return EvidenceEnvelope{}, errors.New("producer repository does not match canonical GoreeCloud repository")
	}
	if !fullGitRevisionPattern.MatchString(v.Producer.Revision) {
		return EvidenceEnvelope{}, errors.New("producer revision must be an exact 40-character lowercase Git revision")
	}
	if v.Producer.Contract == "" {
		return EvidenceEnvelope{}, errors.New("producer contract is required")
	}
	if !producerContractAllowed(v.Producer.System, v.Producer.Contract) {
		return EvidenceEnvelope{}, errors.New("producer contract does not belong to the declared producer authority")
	}
	if !evidenceAuthorityDomains[v.Producer.System][v.AuthorityDomain] {
		return EvidenceEnvelope{}, errors.New("authority domain is not valid for the declared producer")
	}
	if v.Subject.Kind == "" || v.Subject.ID == "" {
		return EvidenceEnvelope{}, errors.New("evidence subject kind and id are required")
	}
	if len(v.Subject.Kind) > 64 || len(v.Subject.ID) > 256 || len(v.Subject.Scope) > 256 {
		return EvidenceEnvelope{}, errors.New("evidence subject fields exceed maximum length")
	}
	if v.Assertion == "" || v.Outcome == "" || v.Source == "" {
		return EvidenceEnvelope{}, errors.New("assertion, outcome, and source are required")
	}
	if len(v.Assertion) > 128 || len(v.Outcome) > 128 || len(v.Source) > 512 {
		return EvidenceEnvelope{}, errors.New("assertion, outcome, or source exceeds maximum length")
	}
	if v.ObservedAt.IsZero() {
		return EvidenceEnvelope{}, errors.New("observed_at is required")
	}
	v.ObservedAt = v.ObservedAt.UTC()
	if v.ObservedAt.After(evaluatedAt) {
		return EvidenceEnvelope{}, errors.New("evidence observation time cannot be after evaluation time")
	}
	if v.ValidUntil.IsZero() {
		return EvidenceEnvelope{}, errors.New("producer-declared valid_until is required")
	}
	v.ValidUntil = v.ValidUntil.UTC()
	if !v.ValidUntil.After(v.ObservedAt) {
		return EvidenceEnvelope{}, errors.New("valid_until must be after observed_at")
	}
	if requireFresh && evaluatedAt.After(v.ValidUntil) {
		return EvidenceEnvelope{}, errors.New("evidence envelope is expired")
	}
	if v.DataClass != EvidencePublic && v.DataClass != EvidenceOperational && v.DataClass != EvidenceDerived {
		return EvidenceEnvelope{}, errors.New("invalid evidence data class")
	}
	if v.ContainsUserContent {
		return EvidenceEnvelope{}, errors.New("evidence envelope must not contain raw user content")
	}
	if v.ContainsSecretMaterial {
		return EvidenceEnvelope{}, errors.New("evidence envelope must not contain credentials, keys, tokens, or secret material")
	}
	if len(v.Summary) > 512 {
		return EvidenceEnvelope{}, errors.New("evidence summary must be at most 512 characters")
	}
	if v.PayloadDigest != "" && !evidenceDigestPattern.MatchString(v.PayloadDigest) {
		return EvidenceEnvelope{}, errors.New("payload_digest must use sha256:<64 lowercase hex characters>")
	}
	return v, nil
}

func producerContractAllowed(producer EvidenceProducerID, contract string) bool {
	if producer == GlazeUIProducer {
		return glazeEvidenceContracts[contract]
	}
	for _, prefix := range evidenceProducerContractPrefixes[producer] {
		if strings.HasPrefix(contract, prefix) {
			return true
		}
	}
	return false
}

func (v EvidenceEnvelope) FreshAt(evaluatedAt time.Time) bool {
	return !v.ValidUntil.IsZero() && !evaluatedAt.UTC().After(v.ValidUntil.UTC())
}
