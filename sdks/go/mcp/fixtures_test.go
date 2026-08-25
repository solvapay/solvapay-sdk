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
	"customer-ref/from-hook.json",
	"customer-ref/from-tool-args.json",
	"error/handler-throws.json",
	"gate/activation-required.json",
	"gate/handler-invoked.json",
	"gate/payment-required.json",
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
