// Package mcp is the layer-3 payable-MCP adapter for the official Go MCP SDK.
//
// Layer 1 is github.com/modelcontextprotocol/go-sdk/mcp (protocol, transports,
// tools/call). Layer 2 is the shared Rust decision core, invoked through
// github.com/solvapay/solvapay-sdk/sdks/go/internal/nativecall. This package is the
// hand-written registration glue.
//
// [NewServer] + [NewStreamableHandler] is the Streamable HTTP path (MCP
// 2026-07-28: resultType / ttlMs / cacheScope / server/discover).
//
// Gate copy is never authored here. See
// docs/contributing/mcp-authoring-adapter-contract.md.
package mcp
