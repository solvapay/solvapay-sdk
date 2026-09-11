package mcp

import (
	_ "embed"
	"strings"
)

//go:embed mcp-app.html
var mcpAppHTML string

const MCPAppMIMEType = "text/html;profile=mcp-app"

func DefaultMCPAppHTML() string {
	return mcpAppHTML
}

func defaultWidgetHasRootMount() bool {
	return strings.Contains(mcpAppHTML, `id="root"`)
}
