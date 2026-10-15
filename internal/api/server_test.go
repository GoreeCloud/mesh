package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/GoreeCloud/goreecloud-mesh/internal/contracts"
	"github.com/GoreeCloud/goreecloud-mesh/internal/mesh"
	"github.com/GoreeCloud/goreecloud-mesh/internal/store"
	"github.com/GoreeCloud/goreecloud-mesh/internal/trust"
)

const testRuntimeRevision = "0123456789abcdef0123456789abcdef01234567"

type staticVerifier struct {
	principal trust.Principal
	err       error
}

func (v staticVerifier) Verify(*http.Request) (trust.Principal, error) {
	return v.principal, v.err
}

func testHandler(t *testing.T) http.Handler {
	t.Helper()
	state, err := store.New("")
	if err != nil {
		t.Fatalf("store: %v", err)
	}
	verifier := staticVerifier{principal: trust.Principal{
		ServiceID: "mesh-test-client",
		Issuer:    "goreecloud-identity",
		Subject:   "service:mesh-test-client",
		Scopes: []string{
			ScopeServicesWrite,
			ScopeRelationshipsWrite,
			ScopePolicyEvaluate,
			ScopeAttestationsWrite,
			ScopeContractsWrite,
		},
	}}
	return NewAuthorized(mesh.New(state), contracts.NewRegistry(), contracts.NewSourceAttestationRegistry(), verifier, nil)
}

func TestRequestLogRedactsPathIdentifiers(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/items/{id}", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := requestLog(logger, mux)
	const sensitiveID = "synthetic-private-identifier"
	request := httptest.NewRequest(http.MethodGet, "/v1/items/"+sensitiveID, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("unexpected HTTP status: %d", response.Code)
	}
	if strings.Contains(logs.String(), sensitiveID) {
		t.Fatal("request log disclosed a URL path identifier")
	}
	if !strings.Contains(logs.String(), "GET /v1/items/{id}") {
		t.Fatalf("missing route pattern in request log: %s", logs.String())
	}
}

func TestDecodeJSONStrictBodyBoundaries(t *testing.T) {
	for _, body := range []string{
		`{"id":"a"}{"id":"b"}`,
		`{"id":"a"} true`,
		`{"id":"a"} garbage`,
		`{"id":"one","id":"two"}`,
		`{"id":"one","ID":"two"}`,
		`{"id":"one","Id":"two"}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/v1/services", bytes.NewBufferString(body))
		var value struct {
			ID string `json:"id"`
		}
		if err := decodeJSON(req, &value); err == nil {
			t.Fatalf("accepted ambiguous request body: %q", body)
		}
	}

	for _, body := range []string{
		`{"a":{"role":1,"role":2}}`,
		`{"a":[{"mode":true,"mode":false}]}`,
		`{"a":{"role":1,"ROLE":2}}`,
		`{"outer":[{"flag":true,"FLAG":false}]}`,
		`{"K":1,"K":2}`,
		`{"s":1,"ſ":2}`,
	} {
		if err := rejectDuplicateJSONKeys([]byte(body)); err == nil {
			t.Fatalf("nested duplicate JSON key was accepted: %s", body)
		}
	}
	for _, body := range []string{
		`{"a":{"role":"viewer"},"b":[{"mode":true},{"mode":false}]}`,
		`{"id":"valid"}`,
		`{"id":"valid","identity":"distinct"}`,
	} {
		if err := rejectDuplicateJSONKeys([]byte(body)); err != nil {
			t.Fatalf("valid nested JSON was rejected: %s err=%v", body, err)
		}
	}

	for _, tc := range []struct {
		depth int
		ok    bool
	}{
		{depth: maxJSONDepth, ok: true},
		{depth: maxJSONDepth + 1, ok: false},
	} {
		nestedArray := strings.Repeat("[", tc.depth) + "0" + strings.Repeat("]", tc.depth)
		nestedObject := strings.Repeat("{\"a\":", tc.depth) + "0" + strings.Repeat("}", tc.depth)
		for _, body := range []string{nestedArray, nestedObject} {
			err := rejectDuplicateJSONKeys([]byte(body))
			if tc.ok && err != nil {
				t.Fatalf("rejected bounded JSON nesting: %v", err)
			}
			if !tc.ok && err == nil {
				t.Fatal("accepted overly deep JSON nesting")
			}
		}
	}

	oversized := append([]byte(`{"id":"a"}`), bytes.Repeat([]byte(" "), 1<<20)...)
	req := httptest.NewRequest(http.MethodPost, "/v1/services", bytes.NewReader(oversized))
	var value struct {
		ID string `json:"id"`
	}
	if err := decodeJSON(req, &value); err == nil {
		t.Fatal("accepted body exceeding the one-megabyte bound")
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/services", bytes.NewBufferString("{\"id\":\"valid\"}  \n"))
	if err := decodeJSON(req, &value); err != nil || value.ID != "valid" {
		t.Fatalf("valid single request rejected: id=%q err=%v", value.ID, err)
	}
}

func TestInvalidJSONNeverRegistersService(t *testing.T) {
	handler := testHandler(t)
	getServices := func() string {
		t.Helper()
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/v1/services", nil))
		if response.Code != http.StatusOK {
			t.Fatalf("list services failed: %d", response.Code)
		}
		return response.Body.String()
	}
	before := getServices()
	for _, body := range []string{
		`{"id":"safe","ID":"hijacked"}`,
		`{"id":"safe"}{"id":"extra"}`,
		`{"id":"safe","details":{"role":"viewer","ROLE":"admin"}}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "/v1/services", strings.NewReader(body))
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid JSON accepted: status=%d body=%q", response.Code, body)
		}
		if after := getServices(); after != before {
			t.Fatalf("rejected input mutated services: before=%q after=%q", before, after)
		}
	}
}

func TestHealthCannotBeMistakenForProductionApproval(t *testing.T) {
	handler := testHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("unexpected health status: %d", rec.Code)
	}
	var got struct {
		Scope              string `json:"scope"`
		ProductionAccepted bool   `json:"production_accepted"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.ProductionAccepted || got.Scope != "development-integration" {
		t.Fatalf("health endpoint overstates acceptance: %+v", got)
	}
}

func TestPlatformCatalogAPI(t *testing.T) {
	h := testHandler(t)
	request := httptest.NewRequest(http.MethodGet, "/v1/platforms", nil)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}

func TestPlatformStatusAPIFailsClosed(t *testing.T) {
	h := testHandler(t)
	request := httptest.NewRequest(http.MethodGet, "/v1/platforms/status", nil)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}

func TestContractStableEligibilityAPI(t *testing.T) {
	h := testHandler(t)

	for _, platform := range contracts.Mandatory() {
		entry, ok := contracts.CatalogFor(platform)
		if !ok {
			t.Fatalf("catalog entry missing for %s", platform)
		}
		body, err := json.Marshal(contracts.Evidence{
			Platform:   platform,
			Repository: entry.Repository,
			Contract:   entry.ContractSource,
			State:      contracts.Validated,
			Source:     "test-adapter",
			Revision:   testRuntimeRevision,
			ValidUntil: time.Now().UTC().Add(time.Hour),
		})
		if err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/v1/contracts", bytes.NewReader(body))
		response := httptest.NewRecorder()
		h.ServeHTTP(response, request)
		if response.Code != http.StatusCreated {
			t.Fatalf("record %s status = %d body=%s", platform, response.Code, response.Body.String())
		}
	}

	request := httptest.NewRequest(http.MethodGet, "/v1/contracts/stable-eligibility", nil)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	var final map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &final); err != nil {
		t.Fatal(err)
	}
	if eligible, _ := final["stable_eligible"].(bool); !eligible {
		t.Fatal("all current validated mandatory contracts should satisfy source-level eligibility evaluation")
	}
}

func TestContractAPIRejectsUnknownPlatform(t *testing.T) {
	h := testHandler(t)
	body := []byte(`{"platform":"other","contract":"v1","state":"validated"}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/contracts", bytes.NewReader(body))
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}

func TestContractAPIRejectsMissingValidity(t *testing.T) {
	h := testHandler(t)
	entry, _ := contracts.CatalogFor(contracts.Wardveil)
	body, _ := json.Marshal(contracts.Evidence{Platform: contracts.Wardveil, Repository: entry.Repository, Contract: entry.ContractSource, State: contracts.Validated, Source: "test-adapter", Revision: testRuntimeRevision})
	request := httptest.NewRequest(http.MethodPost, "/v1/contracts", bytes.NewReader(body))
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}

func TestContractAPIRejectsNonCanonicalValidatedEvidence(t *testing.T) {
	h := testHandler(t)
	body := []byte(`{"platform":"wardveil-security","repository":"GoreeCloud/goreecloud-wardveil-security","contract":"wardveil-runtime-v1","state":"validated","source":"test-adapter","revision":"0123456789abcdef0123456789abcdef01234567","valid_until":"2099-01-01T00:00:00Z"}`)
	request := httptest.NewRequest(http.MethodPost, "/v1/contracts", bytes.NewReader(body))
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
}
