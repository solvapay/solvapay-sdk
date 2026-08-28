package mcp

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestDescriptorsMatchesFrozenDefaultAllViews(t *testing.T) {
	ctx := context.Background()
	env := loadFixtureJSON(t, "descriptors/default-all-views.json")
	args := inputArgs(env)
	want := expectResult(env)

	got, err := Descriptors(ctx, DescriptorsInput{
		ResourceURI:   stringOr(args["resourceUri"], ""),
		PublicBaseURL: stringOr(args["publicBaseUrl"], ""),
		ProductRef:    stringOr(args["productRef"], ""),
	})
	if err != nil {
		t.Fatal(err)
	}
	assertDescriptorsMatch(t, got, want)
}

func TestDescriptorsViewsCheckoutOnlyDropsAccountAndTopup(t *testing.T) {
	ctx := context.Background()
	env := loadFixtureJSON(t, "descriptors/views-checkout-only.json")
	args := inputArgs(env)
	want := expectResult(env)

	viewsRaw, _ := args["views"].([]any)
	views := make([]string, 0, len(viewsRaw))
	for _, v := range viewsRaw {
		if s, ok := v.(string); ok {
			views = append(views, s)
		}
	}

	got, err := Descriptors(ctx, DescriptorsInput{
		ResourceURI:   stringOr(args["resourceUri"], ""),
		PublicBaseURL: stringOr(args["publicBaseUrl"], ""),
		ProductRef:    stringOr(args["productRef"], ""),
		Views:         views,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertDescriptorsMatch(t, got, want)

	names := map[string]bool{}
	for _, tool := range got.Tools {
		names[tool.Name] = true
	}
	if !names["upgrade"] {
		t.Fatal("expected upgrade tool")
	}
	if names["manage_account"] || names["topup"] {
		t.Fatalf("checkout-only views must drop account/topup tools, got %v", names)
	}
}

func assertDescriptorsMatch(t *testing.T, got DescriptorsBundle, want any) {
	t.Helper()
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var projected any
	if err := json.Unmarshal(raw, &projected); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(projected, want) {
		g, _ := json.MarshalIndent(projected, "", "  ")
		w, _ := json.MarshalIndent(want, "", "  ")
		t.Fatalf("descriptors mismatch\ngot:\n%s\nwant:\n%s", g, w)
	}
}

func TestDescriptorsFixtureFilesExist(t *testing.T) {
	root := lookupMcpFixtures(t)
	for _, rel := range []string{
		"descriptors/default-all-views.json",
		"descriptors/views-checkout-only.json",
	} {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); err != nil {
			t.Fatal(err)
		}
	}
}
