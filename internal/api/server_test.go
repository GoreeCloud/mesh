package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestDecodeJSONStrictBodyBoundaries(t *testing.T) {
	for _, body := range []string{
		`{"id":"a"}{"id":"b"}`,
		`{"id":"a"} true`,
		`{"id":"a"} garbage`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/v1/services", bytes.NewBufferString(body))
		var value struct { ID string `json:"id"` }
		if err := decodeJSON(req, &value); err == nil {
			t.Fatalf("accepted ambiguous request body: %q", body)
		}
	}

	oversized := append([]byte(`{"id":"a"}`), bytes.Repeat([]byte(" "), 1<<20)...)
	req := httptest.NewRequest(http.MethodPost, "/v1/services", bytes.NewReader(oversized))
	var value struct { ID string `json:"id"` }
	if err := decodeJSON(req, &value); err == nil {
		t.Fatal("accepted body exceeding the one-megabyte bound")
	}

	req = httptest.NewRequest(http.MethodPost, "/v1/services", bytes.NewBufferString("{\"id\":\"valid\"}  \n"))
	if err := decodeJSON(req, &value); err != nil || value.ID != "valid" {
		t.Fatalf("valid single request rejected: id=%q err=%v", value.ID, err)
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
