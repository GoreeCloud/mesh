package platformregistry

import (
	"testing"
	"time"
)

func fixture() Record {
	now := time.Date(2026, 9, 3, 19, 0, 0, 0, time.UTC)
	return Record{
		Schema: Schema,
		Source: Source{
			Repository:            "GoreeCloud/goreecloud-tasks",
			Revision:              "0123456789abcdef0123456789abcdef01234567",
			ContractSchemaVersion: "0.2",
			AuthorityTransfer:     false,
		},
		Component: Component{
			ID:                 "goreecloud-tasks",
			ProductName:        "GoreeCloud Tasks",
			Kind:               "application",
			Repository:         "GoreeCloud/goreecloud-tasks",
			Lifecycle:          "development",
			Version:            "0.1",
			SupportedPlatforms: []string{"web", "linux-server"},
		},
		Capabilities: []string{"task-management", "portable-user-export"},
		Dependencies: []string{"goreecloud-mesh"},
		Relationships: []Relationship{
			{Target: "goreecloud-manager", Type: "observed-by", Required: false},
		},
		PlatformSystems: map[string]PlatformSystem{
			"manager":           {Result: "applicable-nonconformant"},
			"identity":          {Result: "applicable-migration-required"},
			"wardveil_security": {Result: "applicable-nonconformant"},
			"privacy_shield":    {Result: "applicable-nonconformant"},
			"everkeep":          {Result: "applicable-nonconformant"},
			"mesh":              {Result: "applicable-nonconformant"},
			"glaze_ui":          {Result: "applicable-migration-required"},
		},
		Health: Health{RuntimeState: "unknown", HealthState: "unknown", Readiness: "unknown"},
		Recovery: Recovery{
			BackupStatus:  "required_missing",
			RestoreStatus: "required_missing",
		},
		Portability: Portability{ExportStatus: "implemented_unverified", Formats: []string{"goreecloud-tasks-user-archive-json"}},
		Conformance: Conformance{
			DeclaredResult:           "nonconformant",
			ComputedResult:           "nonconformant",
			StableEligible:           false,
			EvaluatorRepository:      "GoreeCloud/GoreeCloud",
			EvaluatorRevision:        "abcdef0123456789abcdef0123456789abcdef01",
			EvaluatedAt:              now,
			MissingMandatoryEvidence: []string{"restore", "mesh-registration", "glaze-ui"},
			Blockers:                 []string{"required platform evidence remains incomplete"},
		},
		EvidenceRefs: []EvidenceRef{
			{ID: "tasks-readme", Kind: "documentation", Location: "README.md", Producer: "GoreeCloud/goreecloud-tasks"},
		},
		ObservedAt: now,
	}
}

func TestRegistryAcceptsAuthorityPreservingRecord(t *testing.T) {
	registry := New()
	record := fixture()
	if err := registry.Upsert(record); err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}
	got, ok := registry.Get("goreecloud-tasks")
	if !ok {
		t.Fatal("expected registered component")
	}
	if got.Source.Repository != got.Component.Repository {
		t.Fatal("producer authority was not preserved")
	}
	if got.Conformance.StableEligible {
		t.Fatal("nonconformant component became Stable-eligible")
	}
	if got.Conformance.EvaluatorRepository != "GoreeCloud/GoreeCloud" {
		t.Fatal("canonical evaluator provenance was not preserved")
	}
}

func TestRegistryRejectsAuthorityTransfer(t *testing.T) {
	record := fixture()
	record.Source.AuthorityTransfer = true
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected authority transfer to be rejected")
	}
}

func TestRegistryRejectsProducerRepositoryMismatch(t *testing.T) {
	record := fixture()
	record.Source.Repository = "GoreeCloud/goreecloud-manager"
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected repository mismatch to be rejected")
	}
}

func TestRegistryRejectsLegacyPlatformContractVocabulary(t *testing.T) {
	record := fixture()
	record.Source.ContractSchemaVersion = "1.0"
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected legacy Platform Contract schema to be rejected")
	}

	record = fixture()
	record.Component.Lifecycle = "Development"
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected legacy lifecycle display value to be rejected")
	}

	record = fixture()
	system := record.PlatformSystems["glaze_ui"]
	system.Result = "Applicable — Migration Required"
	record.PlatformSystems["glaze_ui"] = system
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected legacy platform-system display value to be rejected")
	}
}

func TestRegistryRejectsInvalidEvaluatorProvenance(t *testing.T) {
	record := fixture()
	record.Conformance.EvaluatorRepository = "GoreeCloud/goreecloud-manager"
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected non-canonical evaluator repository to be rejected")
	}

	record = fixture()
	record.Conformance.EvaluatorRevision = "not-a-git-revision"
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected invalid evaluator revision to be rejected")
	}
}

func TestRegistryRejectsFalseStableEligibility(t *testing.T) {
	record := fixture()
	record.Conformance.StableEligible = true
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected false Stable eligibility to be rejected")
	}

	record = fixture()
	record.Conformance.ComputedResult = "unverified"
	record.Conformance.StableEligible = true
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected unverified state to be rejected as Stable-eligible")
	}
}

func TestRegistryRequiresStableLifecycleEvidence(t *testing.T) {
	record := fixture()
	record.Component.Lifecycle = "stable"
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected Stable lifecycle without computed conformance to be rejected")
	}

	record.Conformance.DeclaredResult = "conformant"
	record.Conformance.ComputedResult = "conformant"
	record.Conformance.StableEligible = true
	if err := New().Upsert(record); err != nil {
		t.Fatalf("stable evidence-backed record rejected: %v", err)
	}
}

func TestRegistryRequiresVerifiedRestoreTimestamp(t *testing.T) {
	record := fixture()
	record.Recovery.RestoreStatus = "verified"
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected verified restore without timestamp to be rejected")
	}

	now := time.Now().UTC()
	record.Recovery.LastVerifiedRestore = &now
	if err := New().Upsert(record); err != nil {
		t.Fatalf("verified restore with timestamp rejected: %v", err)
	}
}

func TestRegistryDoesNotTurnBackupIntoRestoreEvidence(t *testing.T) {
	record := fixture()
	record.Recovery.BackupStatus = "verified"
	record.Recovery.RestoreStatus = "required_missing"
	if err := New().Upsert(record); err != nil {
		t.Fatalf("record rejected: %v", err)
	}
	got, _ := NewWith(record).Get("goreecloud-tasks")
	if got.Recovery.RestoreStatus == "verified" {
		t.Fatal("backup status manufactured a verified restore")
	}
}

func TestRegistryRejectsUnknownVerificationState(t *testing.T) {
	record := fixture()
	record.Portability.ExportStatus = "healthy"
	if err := New().Upsert(record); err == nil {
		t.Fatal("expected unknown verification vocabulary to be rejected")
	}
}

func TestDependentsUsesOnlyDeclaredDependencies(t *testing.T) {
	registry := New()
	mesh := fixture()
	mesh.Component.ID = "goreecloud-mesh"
	mesh.Component.ProductName = "GoreeCloud Mesh"
	mesh.Component.Repository = "GoreeCloud/goreecloud-mesh"
	mesh.Source.Repository = mesh.Component.Repository
	mesh.Dependencies = nil
	mesh.Relationships = nil
	if err := registry.Upsert(mesh); err != nil {
		t.Fatalf("mesh Upsert() error = %v", err)
	}
	tasks := fixture()
	if err := registry.Upsert(tasks); err != nil {
		t.Fatalf("tasks Upsert() error = %v", err)
	}
	got := registry.Dependents("goreecloud-mesh")
	if len(got) != 1 || got[0] != "goreecloud-tasks" {
		t.Fatalf("Dependents() = %v", got)
	}
}

// NewWith is a test helper that keeps production registry construction explicit.
func NewWith(record Record) *Registry {
	registry := New()
	_ = registry.Upsert(record)
	return registry
}
