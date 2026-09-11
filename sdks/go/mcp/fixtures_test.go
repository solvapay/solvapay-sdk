package mcp

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

var mcpAuthoringFixtures = []string{
	"allow/custom-usage-type.json",
	"allow/customer-outcome-flags.json",
	"allow/respond-data-in-text-false.json",
	"allow/respond-emitted-blocks.json",
	"allow/respond-key-order.json",
	"allow/respond-minimal.json",
	"allow/respond-nudge.json",
	"allow/respond-text-option.json",
	"auth-gate/allow-initialize.json",
	"auth-gate/allow-tools-call-with-bearer.json",
	"auth-gate/challenge-tools-call.json",
	"bearer-verify/alg-none.json",
	"bearer-verify/expired.json",
	"bearer-verify/valid-rs256.json",
	"bearer-verify/wrong-audience.json",
	"bearer-verify/wrong-issuer.json",
	"bearer-verify/wrong-key.json",
	"bootstrap/authenticated.json",
	"bootstrap/unauthenticated.json",
	"builtin-tools/account-topup.json",
	"builtin-tools/account-view-account.json",
	"builtin-tools/account.json",
	"builtin-tools/activate-plan-already-active.json",
	"builtin-tools/activate-plan-no-ref.json",
	"builtin-tools/activate-plan.json",
	"builtin-tools/attach-business-details-unauth.json",
	"builtin-tools/attach-business-details.json",
	"builtin-tools/create-hosted-session-portal-unauth.json",
	"builtin-tools/create-hosted-session-portal.json",
	"builtin-tools/create-hosted-session-unauth.json",
	"builtin-tools/create-hosted-session.json",
	"builtin-tools/create-payment-intent-plan-rejects-auto-recharge.json",
	"builtin-tools/create-payment-intent-topup-auto-recharge.json",
	"builtin-tools/create-payment-intent-topup-unauth.json",
	"builtin-tools/create-payment-intent-topup.json",
	"builtin-tools/create-payment-intent-unauth.json",
	"builtin-tools/create-payment-intent.json",
	"builtin-tools/get-history-unauth.json",
	"builtin-tools/get-history.json",
	"builtin-tools/process-payment-unauth.json",
	"builtin-tools/process-payment.json",
	"builtin-tools/set-renewal-cancel.json",
	"builtin-tools/set-renewal-reactivate.json",
	"builtin-tools/set-renewal-unauth.json",
	"config-log/once.json",
	"csp/default.json",
	"csp/with-api-origin.json",
	"customer-ref/from-hook.json",
	"customer-ref/from-tool-args.json",
	"dcr/generic-reject.json",
	"dcr/unresolved-product.json",
	"default-gate/custom-reason.json",
	"default-gate/payment-required.json",
	"descriptors/default-all-views.json",
	"descriptors/views-checkout-only.json",
	"dispatch/challenge.json",
	"dispatch/invoke-handler.json",
	"dispatch/rpc.json",
	"engine/gate-denied.json",
	"engine/initialize.json",
	"engine/invoke-handler.json",
	"engine/modern-missing-capabilities.json",
	"engine/ping-modern.json",
	"engine/prompts-get-unknown.json",
	"engine/prompts-get.json",
	"engine/prompts-list.json",
	"engine/server-discover.json",
	"engine/subscriptions-listen.json",
	"engine/tools-list-modern.json",
	"engine/tools-list-payable.json",
	"engine/tools-list.json",
	"engine/unsupported-method-modern.json",
	"engine/unsupported-method.json",
	"engine/unsupported-version.json",
	"engine/widget-resource-legacy.json",
	"engine/widget-resource-modern.json",
	"error/handler-throws.json",
	"gate/activation-required.json",
	"gate/handler-invoked.json",
	"gate/payment-required.json",
	"hide-tools/app-callable-tool-invoked.json",
	"hide-tools/filter-ui-audience.json",
	"hide-tools/hidden-tool-invoked.json",
	"hide-tools/keeps-private-without-audiences.json",
	"hide-tools/openai-visibility-private.json",
	"hide-tools/ua-spoof.json",
	"narrate/activate-plan.json",
	"narrate/already-active-shortfall.json",
	"narrate/already-active.json",
	"narrate/auto-recharge-failed.json",
	"narrate/auto-recharge-off-url.json",
	"narrate/auto-recharge-off.json",
	"narrate/auto-recharge-on.json",
	"narrate/auto-recharge-portal-fallback.json",
	"narrate/manage-account-active.json",
	"narrate/manage-account.json",
	"narrate/mode-auto.json",
	"narrate/mode-text.json",
	"narrate/mode-ui.json",
	"narrate/placeholder.json",
	"narrate/topup.json",
	"narrate/upgrade.json",
	"narrate/virtual-manage-account.json",
	"narrate/virtual-upgrade-plan-ref.json",
	"narrate/virtual-upgrade.json",
	"native-cors/allowed-cursor.json",
	"native-cors/no-origin.json",
	"native-cors/preflight.json",
	"native-cors/rejected-loose-scheme.json",
	"native-cors/unknown-scheme.json",
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
	"oauth/error-inspect-build-description.json",
	"oauth/error-inspect-derive-code.json",
	"oauth/error-inspect-has-shape.json",
	"oauth/normalize-nestjs-401.json",
	"oauth/normalize-rfc-passthrough.json",
	"oauth/path-leading-slash.json",
	"oauth/path-protected-resource.json",
	"oauth/path-resolve-paths.json",
	"oauth/path-resource-identifier.json",
	"oauth/path-strip-trailing-slash.json",
	"oauth/request-protected-resource-mcp-path.json",
	"overview/resource.json",
	"resolve-auth/free-invalid-bearer.json",
	"resolve-auth/free-no-bearer.json",
	"resolve-auth/gated-local-hs256.json",
	"resolve-auth/gated-no-bearer.json",
	"resolve-auth/gated-remote-userinfo.json",
	"resolve-auth/validator-unreachable.json",
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

func isAsyncClientFixture(rel string) bool {
	return strings.HasPrefix(rel, "bootstrap/") ||
		strings.HasPrefix(rel, "builtin-tools/") ||
		strings.HasPrefix(rel, "oauth-proxy/") ||
		strings.HasPrefix(rel, "dispatch/") ||
		strings.HasPrefix(rel, "resolve-auth/") ||
		rel == "oauth/request-protected-resource-mcp-path.json"
}

func coreOpFixtures() []string {
	var out []string
	for _, rel := range mcpAuthoringFixtures {
		if strings.HasPrefix(rel, "allow/") ||
			strings.HasPrefix(rel, "customer-ref/") ||
			strings.HasPrefix(rel, "error/") ||
			strings.HasPrefix(rel, "gate/") ||
			isAsyncClientFixture(rel) {
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
