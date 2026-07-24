package livecontract_test

import (
	"reflect"
	"testing"

	"github.com/solvapay/solvapay-go/internal/livecontract"
)

func TestScenariosCoverThirtySixOpsInDependencyOrder(t *testing.T) {
	// Python/Ruby/Rust live drivers ship 38 scenarios (36 unique ops + 2 bogus probes).
	if got := len(livecontract.SCENARIOS); got != 38 {
		t.Fatalf("SCENARIOS len = %d, want 38", got)
	}
	unique := map[string]struct{}{}
	for _, s := range livecontract.SCENARIOS {
		unique[s.Op] = struct{}{}
	}
	if got := len(unique); got != 36 {
		t.Fatalf("unique ops = %d, want 36", got)
	}
	if livecontract.SCENARIOS[0].ID != "getMerchant" || livecontract.SCENARIOS[0].Op != "getMerchant" {
		t.Fatalf("first scenario = %+v, want getMerchant", livecontract.SCENARIOS[0])
	}
	last := livecontract.SCENARIOS[len(livecontract.SCENARIOS)-1]
	if last.ID != "deleteProduct" || last.Op != "deleteProduct" {
		t.Fatalf("last scenario = %+v, want deleteProduct", last)
	}
	ids := make([]string, len(livecontract.SCENARIOS))
	for i, s := range livecontract.SCENARIOS {
		ids[i] = s.ID
	}
	createProduct := indexOf(ids, "createProduct")
	deleteProduct := indexOf(ids, "deleteProduct")
	createPlan := indexOf(ids, "createPlan")
	deletePlan := indexOf(ids, "deletePlan")
	if createProduct < 0 || deleteProduct < 0 || createProduct >= deleteProduct {
		t.Fatalf("createProduct (%d) must precede deleteProduct (%d)", createProduct, deleteProduct)
	}
	if createPlan < 0 || deletePlan < 0 || createPlan >= deletePlan {
		t.Fatalf("createPlan (%d) must precede deletePlan (%d)", createPlan, deletePlan)
	}
}

func TestResolveArgsSubstitutesPlaceholdersRecursively(t *testing.T) {
	refs := map[string]string{
		"productRef": "prd_abc",
		"sideTag":    "go-1",
	}
	template := map[string]any{
		"productRef": "{productRef}",
		"name":       "Shadow Product Scenario {sideTag}",
		"events":     []any{map[string]any{"customerRef": "{productRef}", "units": 1}},
		"nested":     map[string]any{"tag": "{sideTag}"},
	}
	resolved := livecontract.ResolveArgs(template, refs)
	got, ok := resolved.(map[string]any)
	if !ok {
		t.Fatalf("ResolveArgs type = %T, want map", resolved)
	}
	if got["productRef"] != "prd_abc" {
		t.Fatalf("productRef = %v", got["productRef"])
	}
	if got["name"] != "Shadow Product Scenario go-1" {
		t.Fatalf("name = %v", got["name"])
	}
	events, ok := got["events"].([]any)
	if !ok || len(events) != 1 {
		t.Fatalf("events = %#v", got["events"])
	}
	event, ok := events[0].(map[string]any)
	if !ok || event["customerRef"] != "prd_abc" {
		t.Fatalf("events[0] = %#v", events[0])
	}
	nested, ok := got["nested"].(map[string]any)
	if !ok || nested["tag"] != "go-1" {
		t.Fatalf("nested = %#v", got["nested"])
	}
}

func TestExtractRefChecksTopLevelAndNested(t *testing.T) {
	if got := livecontract.ExtractRef(map[string]any{"reference": "prd_1"}, []string{"reference", "productRef"}); got != "prd_1" {
		t.Fatalf("top-level = %q, want prd_1", got)
	}
	if got := livecontract.ExtractRef(
		map[string]any{"product": map[string]any{"productRef": "prd_nested"}},
		[]string{"reference", "productRef"},
	); got != "prd_nested" {
		t.Fatalf("nested = %q, want prd_nested", got)
	}
	if got := livecontract.ExtractRef("not-an-object", []string{"reference"}); got != "" {
		t.Fatalf("non-object = %q, want empty", got)
	}
}

func TestNormalizeStripsVolatileKeysSuffixesAndNulls(t *testing.T) {
	raw := map[string]any{
		"ok": true,
		"value": map[string]any{
			"id":          "x",
			"reference":   "prd_1",
			"createdAt":   "2026-01-01",
			"name":        "Keep",
			"checkoutUrl": "https://example.com",
			"token":       "secret",
			"planRef":     "pln_1",
			"nested": map[string]any{
				"updatedAt": "t",
				"status":    "active",
				"gone":      nil,
			},
			"dropNull": nil,
		},
	}
	normalized := livecontract.Normalize(raw)
	want := map[string]any{
		"ok": true,
		"value": map[string]any{
			"name": "Keep",
			"nested": map[string]any{
				"status": "active",
			},
		},
	}
	if !reflect.DeepEqual(normalized, want) {
		t.Fatalf("normalize = %#v, want %#v", normalized, want)
	}
}

func TestScoreScenarioIdenticalOnSuccessAndStructuredExpectError(t *testing.T) {
	success := livecontract.Scenario{
		ID: "getMerchant", Op: "getMerchant", Args: map[string]any{},
	}
	if got := livecontract.ScoreScenario(success, map[string]any{"ok": true, "value": map[string]any{}}); got != "IDENTICAL" {
		t.Fatalf("success ok = %s, want IDENTICAL", got)
	}
	if got := livecontract.ScoreScenario(success, map[string]any{"ok": false, "error": map[string]any{"message": "nope"}}); got != "DIVERGED" {
		t.Fatalf("success err = %s, want DIVERGED", got)
	}

	expectErr := livecontract.Scenario{
		ID: "cloneProduct", Op: "cloneProduct", Args: map[string]any{}, ExpectError: true,
	}
	if got := livecontract.ScoreScenario(expectErr, map[string]any{
		"ok": false,
		"error": map[string]any{
			"name": "SolvaPayError", "message": "boom", "status": 500,
		},
	}); got != "IDENTICAL" {
		t.Fatalf("expect_error structured = %s, want IDENTICAL", got)
	}
	if got := livecontract.ScoreScenario(expectErr, map[string]any{"ok": true, "value": map[string]any{}}); got != "DIVERGED" {
		t.Fatalf("expect_error success = %s, want DIVERGED", got)
	}
}

func TestIsStructuredErrorRequiresOkFalseAndMessage(t *testing.T) {
	if livecontract.IsStructuredError(map[string]any{"ok": true}) {
		t.Fatal("ok:true should not be structured error")
	}
	if livecontract.IsStructuredError(map[string]any{"ok": false, "error": "string"}) {
		t.Fatal("string error should not be structured")
	}
	if livecontract.IsStructuredError(map[string]any{"ok": false, "error": map[string]any{"message": ""}}) {
		t.Fatal("empty message should not be structured")
	}
	if !livecontract.IsStructuredError(map[string]any{
		"ok": false, "error": map[string]any{"message": "Payment required"},
	}) {
		t.Fatal("expected structured error")
	}
}

func indexOf(items []string, want string) int {
	for i, item := range items {
		if item == want {
			return i
		}
	}
	return -1
}
