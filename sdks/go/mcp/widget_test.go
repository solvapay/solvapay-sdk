package mcp

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestDefaultMCPAppHTMLHasRootMount(t *testing.T) {
	html := DefaultMCPAppHTML()
	if html == "" || !defaultWidgetHasRootMount() {
		t.Fatal("vendored mcp-app.html is missing id=\"root\"")
	}
	if MCPAppMIMEType != "text/html;profile=mcp-app" {
		t.Fatalf("unexpected mime type %q", MCPAppMIMEType)
	}
}

func TestVendoredWidgetMatchesCanonical(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	canonical := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tools", "mcp-app-widget", "mcp-app.html")
	want, err := os.ReadFile(canonical)
	if err != nil {
		t.Fatal(err)
	}
	if DefaultMCPAppHTML() != string(want) {
		t.Fatal("go mcp-app.html drifted from tools/mcp-app-widget/mcp-app.html")
	}
}
