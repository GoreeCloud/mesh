package trust

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
)

type Principal struct {
	ServiceID string   `json:"service_id"`
	Scopes    []string `json:"scopes,omitempty"`
	Issuer    string   `json:"issuer,omitempty"`
	Subject   string   `json:"subject,omitempty"`
}

type Verifier interface {
	Verify(*http.Request) (Principal, error)
}

type contextKey struct{}

func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, contextKey{}, normalize(p))
}

func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(contextKey{}).(Principal)
	return p, ok
}

func HasScope(p Principal, scope string) bool {
	scope = strings.TrimSpace(scope)
	if scope == "" {
		return false
	}
	for _, candidate := range p.Scopes {
		if candidate == scope {
			return true
		}
	}
	return false
}

func Validate(p Principal) error {
	p = normalize(p)
	if p.ServiceID == "" {
		return errors.New("service identity is required")
	}
	if p.Issuer == "" {
		return errors.New("identity issuer is required")
	}
	// Mesh service scopes are tied to a single, verified service subject.
	// A verifier must not authorize a principal whose claimed service and
	// subject identify different services.
	if p.Subject == "" {
		return errors.New("service subject is required")
	}
	if p.Subject != "service:"+p.ServiceID {
		return errors.New("service subject does not match service identity")
	}
	return nil
}

func normalize(p Principal) Principal {
	p.ServiceID = strings.TrimSpace(p.ServiceID)
	p.Issuer = strings.TrimSpace(p.Issuer)
	p.Subject = strings.TrimSpace(p.Subject)
	seen := map[string]struct{}{}
	out := make([]string, 0, len(p.Scopes))
	for _, scope := range p.Scopes {
		scope = strings.TrimSpace(scope)
		if scope == "" {
			continue
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		out = append(out, scope)
	}
	sort.Strings(out)
	p.Scopes = out
	return p
}
