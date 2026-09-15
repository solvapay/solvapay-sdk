package mcp

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func lookupMcpFixtures(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		manifest := filepath.Join(dir, "contract", "manifest", "repo-paths.yaml")
		if st, err := os.Stat(manifest); err == nil && !st.IsDir() {
			rel := scanMcpFixtures(t, manifest)
			return filepath.Join(dir, filepath.FromSlash(rel))
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("could not locate contract/manifest/repo-paths.yaml")
		}
		dir = parent
	}
}

func scanMcpFixtures(t *testing.T, manifest string) string {
	t.Helper()
	raw, err := os.ReadFile(manifest)
	if err != nil {
		t.Fatal(err)
	}
	inLookups := false
	for _, line := range strings.Split(string(raw), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "lookups:" {
			inLookups = true
			continue
		}
		if inLookups && strings.HasPrefix(line, " ") == false && strings.HasPrefix(line, "\t") == false && trimmed != "" && !strings.HasPrefix(trimmed, "#") {
			inLookups = false
		}
		if !inLookups {
			continue
		}
		if strings.HasPrefix(trimmed, "mcpFixtures:") {
			value := strings.TrimSpace(strings.TrimPrefix(trimmed, "mcpFixtures:"))
			value = strings.Trim(value, `"'`)
			if value == "" {
				t.Fatal("lookups.mcpFixtures must be a non-empty string")
			}
			return value
		}
	}
	t.Fatal("lookups.mcpFixtures is missing from repo-paths.yaml")
	return ""
}
