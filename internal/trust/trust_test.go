package trust

import (
	"context"
	"testing"
)

func TestValidateRequiresIdentityAndIssuer(t *testing.T) {
	if err := Validate(Principal{}); err == nil {
		t.Fatal("empty principal must be rejected")
	}
	if err := Validate(Principal{ServiceID: "goreecloud-manager"}); err == nil {
		t.Fatal("principal without issuer must be rejected")
	}
	if err := Validate(Principal{ServiceID: "goreecloud-manager", Issuer: "goreecloud-identity", Subject: "service:goreecloud-manager"}); err != nil {
		t.Fatalf("valid principal rejected: %v", err)
	}
}

func TestSubjectMustMatchVerifiedServiceIdentity(t *testing.T) {
	for _, subject := range []string{"", "service:unrelated", "user:client"} {
		p := Principal{ServiceID: "client", Issuer: "goreecloud-identity", Subject: subject}
		if err := Validate(p); err == nil {
			t.Fatalf("unbound service subject %q was accepted", subject)
		}
	}
	good := Principal{ServiceID: " client ", Issuer: " goreecloud-identity ", Subject: " service:client "}
	if err := Validate(good); err != nil {
		t.Fatalf("matching normalized service subject was rejected: %v", err)
	}
}

func TestScopesAreNormalizedAndFailClosed(t *testing.T) {
	p := Principal{ServiceID: " manager ", Issuer: " identity ", Scopes: []string{"mesh.read", "mesh.write", "mesh.read", " "}}
	ctx := WithPrincipal(context.Background(), p)
	got, ok := PrincipalFromContext(ctx)
	if !ok {
		t.Fatal("principal missing from context")
	}
	if got.ServiceID != "manager" || got.Issuer != "identity" {
		t.Fatalf("principal not normalized: %#v", got)
	}
	if !HasScope(got, "mesh.read") || !HasScope(got, "mesh.write") {
		t.Fatalf("expected scopes missing: %#v", got.Scopes)
	}
	if HasScope(got, "mesh.admin") || HasScope(got, "") {
		t.Fatal("unknown or empty scope must fail closed")
	}
}
