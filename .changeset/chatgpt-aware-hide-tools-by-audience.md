---
'@solvapay/mcp': minor
'@solvapay/mcp-core': minor
---

`hideToolsByAudience` on `createSolvaPayMcpServer` and `createSolvaPayMcpFetch` is now ChatGPT-aware. The audience filter still trims `tools/list` for text-only hosts (Claude Desktop, MCPJam, Cursor) so the LLM only sees the four intent tools — `upgrade`, `manage_account`, `activate_plan`, `topup` — alongside your own merchant-registered data tools, but it now **automatically returns the full eleven-tool catalog to ChatGPT**. Without this, ChatGPT's Custom Connector gateway re-validates iframe-initiated `tools/call` against the cached `tools/list` and rejects any hidden tool with `MCP error -32000: MCP Resource not found`, breaking the embedded SolvaPay iframe.

The auto-detection runs against `request.headers['user-agent']` and the post-`initialize` `clientInfo.name`, both matched against `/openai-mcp/i`. Verified live against `openai-mcp/1.0.0 (ChatGPT)` on goldberg-demo (probe 2026-05-04). The pattern is liberal enough to survive a UA bump to `openai-mcp/2.x` without code changes.

Pass the new object form to extend or override the bypass:

```ts
hideToolsByAudience: {
  audiences: ['ui'],
  bypassWhen: ctx => /openai-mcp|future-iframe-host/i.test(
    ctx.extra?.requestInfo?.headers?.['user-agent'] ?? '',
  ),
}
```

Or pass `bypassWhen: () => false` to apply the filter unconditionally on a known text-only deployment.

The array shorthand (`hideToolsByAudience: ['ui']`) keeps working — it's just shorthand for `{ audiences: ['ui'] }` and gets the default ChatGPT-aware bypass for free. No migration needed for existing integrators.

New exports from `@solvapay/mcp-core`: `defaultIsChatGptRequest`, `ApplyHideToolsByAudienceContext`, `ApplyHideToolsByAudienceOptions`, `HideToolsByAudienceBypass`. New export from `@solvapay/mcp`: `HideToolsByAudienceConfig`.
