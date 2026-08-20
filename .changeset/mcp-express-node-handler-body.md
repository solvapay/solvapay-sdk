---
'@solvapay/mcp': patch
---

Fix the documented Express mounting pattern for `@solvapay/mcp/express`. Express calls middleware as `(req, res, next)`, so `toNodeHandler(handler)` mounted directly with `app.all('/mcp', ...)` receives `next` where it expects the pre-parsed body, then tries to re-read a stream that `express.json()` has already consumed — every authenticated `/mcp` call failed with `Parse error: Invalid JSON` right after OAuth succeeded. Pass `req.body` explicitly:

```ts
const handleMcp = toNodeHandler(createMcpHandler(() => server))
app.all('/mcp', (req, res) => {
  void handleMcp(req, res, req.body)
})
```
