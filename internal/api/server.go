package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/GoreeCloud/goreecloud-mesh/internal/contracts"
	"github.com/GoreeCloud/goreecloud-mesh/internal/governance"
	"github.com/GoreeCloud/goreecloud-mesh/internal/mesh"
	"github.com/GoreeCloud/goreecloud-mesh/internal/model"
	"github.com/GoreeCloud/goreecloud-mesh/internal/trust"
)

type Server struct {
	mesh         *mesh.Mesh
	contracts    *contracts.Registry
	attestations *contracts.SourceAttestationRegistry
	recovery     *governance.RecoveryRegistry
	envelopes    *contracts.EvidenceEnvelopeRegistry
	verifier     trust.Verifier
	logger       *slog.Logger
}

func New(m *mesh.Mesh, registry *contracts.Registry, logger *slog.Logger) http.Handler {
	return NewAuthorizedWithRecoveryAndEvidence(m, registry, contracts.NewSourceAttestationRegistry(), governance.NewRecoveryRegistry(), contracts.NewEvidenceEnvelopeRegistry(), nil, logger)
}

func NewWithAttestations(m *mesh.Mesh, registry *contracts.Registry, attestations *contracts.SourceAttestationRegistry, logger *slog.Logger) http.Handler {
	return NewAuthorizedWithRecoveryAndEvidence(m, registry, attestations, governance.NewRecoveryRegistry(), contracts.NewEvidenceEnvelopeRegistry(), nil, logger)
}

func NewAuthorized(m *mesh.Mesh, registry *contracts.Registry, attestations *contracts.SourceAttestationRegistry, verifier trust.Verifier, logger *slog.Logger) http.Handler {
	return NewAuthorizedWithRecoveryAndEvidence(m, registry, attestations, governance.NewRecoveryRegistry(), contracts.NewEvidenceEnvelopeRegistry(), verifier, logger)
}

func NewAuthorizedWithRecovery(m *mesh.Mesh, registry *contracts.Registry, attestations *contracts.SourceAttestationRegistry, recovery *governance.RecoveryRegistry, verifier trust.Verifier, logger *slog.Logger) http.Handler {
	return NewAuthorizedWithRecoveryAndEvidence(m, registry, attestations, recovery, contracts.NewEvidenceEnvelopeRegistry(), verifier, logger)
}

func NewAuthorizedWithRecoveryAndEvidence(m *mesh.Mesh, registry *contracts.Registry, attestations *contracts.SourceAttestationRegistry, recovery *governance.RecoveryRegistry, envelopes *contracts.EvidenceEnvelopeRegistry, verifier trust.Verifier, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	if registry == nil {
		registry = contracts.NewRegistry()
	}
	if attestations == nil {
		attestations = contracts.NewSourceAttestationRegistry()
	}
	if recovery == nil {
		recovery = governance.NewRecoveryRegistry()
	}
	if envelopes == nil {
		envelopes = contracts.NewEvidenceEnvelopeRegistry()
	}
	s := &Server{mesh: m, contracts: registry, attestations: attestations, recovery: recovery, envelopes: envelopes, verifier: verifier, logger: logger}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("GET /v1/state", s.state)
	mux.HandleFunc("GET /v1/services", s.services)
	mux.HandleFunc("POST /v1/services", requireScope(verifier, ScopeServicesWrite, s.services))
	mux.HandleFunc("GET /v1/services/{id}", s.service)
	mux.HandleFunc("GET /v1/capabilities/{capability}", s.capability)
	mux.HandleFunc("POST /v1/relationships", requireScope(verifier, ScopeRelationshipsWrite, s.relationships))
	mux.HandleFunc("GET /v1/graph/impact", s.impact)
	mux.HandleFunc("POST /v1/evaluate", requireScope(verifier, ScopePolicyEvaluate, s.evaluate))
	mux.HandleFunc("GET /v1/platforms", s.platforms)
	mux.HandleFunc("GET /v1/platforms/status", s.platformStatuses)
	mux.HandleFunc("GET /v1/platforms/source-attestations", s.sourceAttestationsList)
	mux.HandleFunc("POST /v1/platforms/source-attestations", requireScope(verifier, ScopeAttestationsWrite, s.sourceAttestationsRecord))
	mux.HandleFunc("GET /v1/contracts", s.contractsList)
	mux.HandleFunc("POST /v1/contracts", requireScope(verifier, ScopeContractsWrite, s.contractsRecord))
	mux.HandleFunc("GET /v1/contracts/stable-eligibility", s.contractsStableEligibility)
	mux.HandleFunc("GET /v1/evidence/envelopes", requireScope(verifier, ScopeEvidenceRead, s.evidenceEnvelopesList))
	mux.HandleFunc("POST /v1/evidence/envelopes", requireScope(verifier, ScopeEvidenceWrite, s.evidenceEnvelopesRecord))
	mux.HandleFunc("GET /v1/evidence/envelopes/{id}", requireScope(verifier, ScopeEvidenceRead, s.evidenceEnvelopeGet))
	mux.HandleFunc("GET /v1/evidence/status", requireScope(verifier, ScopeEvidenceRead, s.evidenceStatus))
	mux.HandleFunc("GET /v1/evidence/subjects/{kind}/{id}", requireScope(verifier, ScopeEvidenceRead, s.evidenceSubject))
	mux.HandleFunc("GET /v1/everkeep/recovery-evidence", s.recoveryEvidenceList)
	mux.HandleFunc("POST /v1/everkeep/recovery-evidence", requireScope(verifier, ScopeRecoveryWrite, s.recoveryEvidenceRecord))
	mux.HandleFunc("GET /v1/everkeep/recovery-readiness", s.recoveryReadiness)
	return requestLog(logger, mux)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "service": "goreecloud-mesh"})
}
func (s *Server) state(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.mesh.State())
}

func (s *Server) services(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, s.mesh.Services())
		return
	}
	var v model.Service
	if err := decodeJSON(r, &v); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	created, err := s.mesh.RegisterService(v)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) service(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	v, ok := s.mesh.Service(id)
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("service not found"))
		return
	}
	writeJSON(w, http.StatusOK, v)
}

func (s *Server) capability(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, s.mesh.Discover(r.PathValue("capability")))
}

func (s *Server) relationships(w http.ResponseWriter, r *http.Request) {
	var v model.Relationship
	if err := decodeJSON(r, &v); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	created, err := s.mesh.AddRelationship(v)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) impact(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, errors.New("id is required"))
		return
	}
	if _, ok := s.mesh.Service(id); !ok {
		writeError(w, http.StatusNotFound, errors.New("service not found"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"service": id, "affected": s.mesh.Impact(id)})
}

func (s *Server) evaluate(w http.ResponseWriter, r *http.Request) {
	var req model.PolicyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusOK, s.mesh.Evaluate(req))
}

func (s *Server) platforms(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"systems": contracts.Catalog(), "note": "Mesh coordinates these systems but does not assume their authority."})
}

func (s *Server) platformStatuses(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"stable_eligible":               s.contracts.StableEligible(),
		"source_attestations_validated": s.attestations.AllValidated(),
		"systems":                       s.contracts.IntegrationStatuses(),
		"note":                          "Source provenance and runtime evidence are independent; neither authorizes production or Stable promotion by itself.",
	})
}

func (s *Server) sourceAttestationsList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"all_validated": s.attestations.AllValidated(), "attestations": s.attestations.List(), "note": "Source attestations prove reviewed producer source only and cannot imply runtime or Stable acceptance."})
}

func (s *Server) sourceAttestationsRecord(w http.ResponseWriter, r *http.Request) {
	var attestation contracts.SourceAttestation
	if err := decodeJSON(r, &attestation); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	recorded, err := s.attestations.Record(attestation)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, recorded)
}

func (s *Server) contractsList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"mandatory": contracts.Mandatory(), "evidence": s.contracts.List()})
}

func (s *Server) contractsRecord(w http.ResponseWriter, r *http.Request) {
	var evidence contracts.Evidence
	if err := decodeJSON(r, &evidence); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	recorded, err := s.contracts.Record(evidence)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, recorded)
}

func (s *Server) contractsStableEligibility(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"stable_eligible": s.contracts.StableEligible(), "mandatory": contracts.Mandatory(), "evidence": s.contracts.List()})
}

type evidenceEnvelopeView struct {
	contracts.EvidenceEnvelope
	Fresh bool `json:"fresh"`
}

func (s *Server) evidenceEnvelopesList(w http.ResponseWriter, r *http.Request) {
	currentOnly, err := parseOptionalBool(r.URL.Query().Get("current"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}

	now := time.Now().UTC()
	items := s.envelopes.List()
	views := make([]evidenceEnvelopeView, 0, len(items))
	current := 0
	stale := 0
	for _, envelope := range items {
		fresh := envelope.FreshAt(now)
		if currentOnly != nil && *currentOnly != fresh {
			continue
		}
		if !matchesEvidenceEnvelopeQuery(envelope, r) {
			continue
		}
		if fresh {
			current++
		} else {
			stale++
		}
		views = append(views, evidenceEnvelopeView{EvidenceEnvelope: envelope, Fresh: fresh})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"count":         len(views),
		"current_count": current,
		"stale_count":   stale,
		"envelopes":     views,
		"note":          "Freshness describes producer-declared evidence validity only. Mesh transport acceptance does not upgrade producer domain truth.",
	})
}

func (s *Server) evidenceEnvelopesRecord(w http.ResponseWriter, r *http.Request) {
	var envelope contracts.EvidenceEnvelope
	if err := decodeJSON(r, &envelope); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	principal, err := validateEvidenceProducerPrincipal(r, envelope)
	if err != nil {
		writeError(w, http.StatusForbidden, err)
		return
	}
	result, err := s.envelopes.RecordWithResult(envelope)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}
	acceptedAt := time.Now().UTC()
	writeJSON(w, status, evidenceDeliveryReceipt{
		Envelope:          evidenceEnvelopeView{EvidenceEnvelope: result.Envelope, Fresh: result.Envelope.FreshAt(acceptedAt)},
		Replayed:          result.Replayed,
		AcceptedAt:        acceptedAt,
		ProducerServiceID: principal.ServiceID,
		Note:              "Mesh accepted transport from the authenticated producer service. Acceptance does not upgrade or reinterpret producer domain truth.",
	})
}

func (s *Server) evidenceEnvelopeGet(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		writeError(w, http.StatusBadRequest, errors.New("evidence envelope id is required"))
		return
	}
	envelope, ok := s.envelopes.Get(id)
	if !ok {
		writeError(w, http.StatusNotFound, errors.New("evidence envelope not found"))
		return
	}
	writeJSON(w, http.StatusOK, evidenceEnvelopeView{EvidenceEnvelope: envelope, Fresh: envelope.FreshAt(time.Now().UTC())})
}

func (s *Server) evidenceStatus(w http.ResponseWriter, _ *http.Request) {
	now := time.Now().UTC()
	type counts struct {
		Current int `json:"current"`
		Stale   int `json:"stale"`
	}
	byProducer := map[contracts.EvidenceProducerID]counts{}
	for _, envelope := range s.envelopes.List() {
		v := byProducer[envelope.Producer.System]
		if envelope.FreshAt(now) {
			v.Current++
		} else {
			v.Stale++
		}
		byProducer[envelope.Producer.System] = v
	}
	current, stale := s.envelopes.CountsAt(now)
	writeJSON(w, http.StatusOK, map[string]any{
		"current":     current,
		"stale":       stale,
		"by_producer": byProducer,
		"note":        "This is evidence transport/freshness state. It is not a security, privacy, recovery, continuity, or design-conformance verdict.",
	})
}

func (s *Server) evidenceSubject(w http.ResponseWriter, r *http.Request) {
	kind := strings.TrimSpace(r.PathValue("kind"))
	id := strings.TrimSpace(r.PathValue("id"))
	if kind == "" || id == "" {
		writeError(w, http.StatusBadRequest, errors.New("evidence subject kind and id are required"))
		return
	}
	view := buildEvidenceSubjectView(s.envelopes.List(), kind, id, r.URL.Query().Get("scope"), time.Now().UTC())
	writeJSON(w, http.StatusOK, view)
}

func matchesEvidenceEnvelopeQuery(envelope contracts.EvidenceEnvelope, r *http.Request) bool {
	q := r.URL.Query()
	if producer := strings.TrimSpace(q.Get("producer")); producer != "" && string(envelope.Producer.System) != producer {
		return false
	}
	if domain := strings.TrimSpace(q.Get("authority_domain")); domain != "" && envelope.AuthorityDomain != domain {
		return false
	}
	if kind := strings.TrimSpace(q.Get("subject_kind")); kind != "" && envelope.Subject.Kind != kind {
		return false
	}
	if id := strings.TrimSpace(q.Get("subject_id")); id != "" && envelope.Subject.ID != id {
		return false
	}
	if assertion := strings.TrimSpace(q.Get("assertion")); assertion != "" && envelope.Assertion != assertion {
		return false
	}
	return true
}

func parseOptionalBool(value string) (*bool, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	if value == "true" {
		v := true
		return &v, nil
	}
	if value == "false" {
		v := false
		return &v, nil
	}
	return nil, errors.New("boolean query parameter must be true or false")
}

func (s *Server) recoveryEvidenceList(w http.ResponseWriter, _ *http.Request) {
	now := time.Now().UTC()
	writeJSON(w, http.StatusOK, map[string]any{
		"ready":               s.recovery.Ready(now),
		"required_dimensions": governance.RequiredRecoveryDimensions(),
		"evidence":            s.recovery.List(),
		"note":                "Recovery readiness is evidence inspection only and does not itself establish production Everkeep acceptance or Stable qualification.",
	})
}

func (s *Server) recoveryEvidenceRecord(w http.ResponseWriter, r *http.Request) {
	var evidence governance.RecoveryEvidence
	if err := decodeJSON(r, &evidence); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	recorded, err := s.recovery.Record(evidence, time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	writeJSON(w, http.StatusCreated, recorded)
}

func (s *Server) recoveryReadiness(w http.ResponseWriter, _ *http.Request) {
	now := time.Now().UTC()
	writeJSON(w, http.StatusOK, map[string]any{"ready": s.recovery.Ready(now), "required_dimensions": governance.RequiredRecoveryDimensions(), "evidence": s.recovery.List()})
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	const maxBodyBytes = 1 << 20
	body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
	if err != nil {
		return err
	}
	if len(body) > maxBodyBytes {
		return errors.New("JSON request exceeds size limit")
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	// A second JSON document, even after a valid first document, is not
	// authoritative API input. Ensure the entire bounded body was consumed.
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values are not permitted")
		}
		return err
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}

func requestLog(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		logger.Info("request", "method", r.Method, "path", r.URL.Path, "duration_ms", time.Since(start).Milliseconds())
	})
}
