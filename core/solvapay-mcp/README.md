# solvapay-mcp-core

Shared MCP product surface: descriptors, OAuth, the auth gate, and the
JSON-RPC engine. Language adapters consume this crate through the binding
layer. Application code should depend on the public `solvapay` facade or
the language MCP adapter (`solvapay-mcp`), not this crate directly.
