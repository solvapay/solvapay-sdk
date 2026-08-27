package mcp

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

var mcpAuthoringFixtures = []string{
	"allow/respond-emitted-blocks.json",
	"allow/respond-key-order.json",
	"allow/respond-minimal.json",
	"allow/respond-nudge.json",
	"allow/respond-text-option.json",
	"auth-gate/allow-initialize.json",
	"auth-gate/allow-tools-call-with-bearer.json",
	"auth-gate/challenge-tools-call.json",
	"bootstrap/unauthenticated.json",
	"builtin-tools/activate-plan-no-ref.json",
	"builtin-tools/activate-plan.json",
	"builtin-tools/attach-business-details-unauth.json",
	"builtin-tools/attach-business-details.json",
	"builtin-tools/cancel-renewal-unauth.json",
	"builtin-tools/cancel-renewal.json",
	"builtin-tools/create-checkout-session-unauth.json",
	"builtin-tools/create-checkout-session.json",
	"builtin-tools/create-customer-session-unauth.json",
	"builtin-tools/create-customer-session.json",
	"builtin-tools/create-payment-intent-unauth.json",
	"builtin-tools/create-payment-intent.json",
	"builtin-tools/create-topup-payment-intent-unauth.json",
	"builtin-tools/create-topup-payment-intent.json",
	"builtin-tools/manage-account.json",
	"builtin-tools/process-payment-unauth.json",
	"builtin-tools/process-payment.json",
	"builtin-tools/reactivate-renewal-unauth.json",
	"builtin-tools/reactivate-renewal.json",
	"builtin-tools/topup.json",
	"builtin-tools/upgrade.json",
	"config-log/once.json",
	"csp/default.json",
	"csp/with-api-origin.json",
	"customer-ref/from-hook.json",
	"customer-ref/from-tool-args.json",
	"dcr/generic-reject.json",
	"dcr/unresolved-product.json",
	"descriptors/default-all-views.json",
	"descriptors/views-checkout-only.json",
	"dispatch/challenge.json",
	"dispatch/invoke-handler.json",
	"dispatch/rpc.json",
	"engine/gate-denied.json",
	"engine/initialize.json",
	"engine/invoke-handler.json",
	"engine/tools-list.json",
	"error/handler-throws.json",
	"gate/activation-required.json",
	"gate/handler-invoked.json",
	"gate/payment-required.json",
	"hide-tools/bypass-chatgpt.json",
	"hide-tools/filter-ui-audience.json",
	"narrate/activate-plan.json",
	"narrate/manage-account-active.json",
	"narrate/manage-account.json",
	"narrate/mode-auto.json",
	"narrate/mode-text.json",
	"narrate/mode-ui.json",
	"narrate/placeholder.json",
	"narrate/topup.json",
	"narrate/upgrade.json",
	"oauth-proxy/authorize.json",
	"oauth-proxy/discovery-authorization-server.json",
	"oauth-proxy/discovery-post-405.json",
	"oauth-proxy/discovery-protected-resource.json",
	"oauth-proxy/openid-404.json",
	"oauth-proxy/paths-override.json",
	"oauth-proxy/register-502.json",
	"oauth-proxy/token-502.json",
	"oauth/discovery-authorization-server.json",
	"oauth/discovery-protected-resource-mcp-path.json",
	"oauth/discovery-protected-resource.json",
	"oauth/normalize-nestjs-401.json",
	"oauth/normalize-rfc-passthrough.json",
	"overview/resource.json",
}

func registerPayableFixtures() []string {
	var out []string
	for _, rel := range mcpAuthoringFixtures {
		if strings.HasPrefix(rel, "allow/") ||
			strings.HasPrefix(rel, "customer-ref/") ||
			strings.HasPrefix(rel, "error/") ||
			strings.HasPrefix(rel, "gate/") {
			out = append(out, rel)
		}
	}
	return out
}

func coreOpFixtures() []string {
	var out []string
	for _, rel := range mcpAuthoringFixtures {
		if strings.HasPrefix(rel, "allow/") ||
			strings.HasPrefix(rel, "customer-ref/") ||
			strings.HasPrefix(rel, "error/") ||
			strings.HasPrefix(rel, "gate/") ||
			strings.HasPrefix(rel, "bootstrap/") ||
			strings.HasPrefix(rel, "builtin-tools/") ||
			strings.HasPrefix(rel, "oauth-proxy/") ||
			strings.HasPrefix(rel, "dispatch/") {
			continue
		}
		out = append(out, rel)
	}
	return out
}

func discoverFixtures(root string) ([]string, error) {
	var rels []string
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".json") {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		rels = append(rels, filepath.ToSlash(rel))
		return nil
	})
	sort.Strings(rels)
	return rels, err
}

func TestDiscoversTheFrozenFixtureList(t *testing.T) {
	root := lookupMcpFixtures(t)
	got, err := discoverFixtures(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(mcpAuthoringFixtures) {
		t.Fatalf("discovered %d fixtures, want %d\ngot %v\nwant %v", len(got), len(mcpAuthoringFixtures), got, mcpAuthoringFixtures)
	}
	for i := range mcpAuthoringFixtures {
		if got[i] != mcpAuthoringFixtures[i] {
			t.Fatalf("fixture[%d] = %q, want %q", i, got[i], mcpAuthoringFixtures[i])
		}
	}
}
