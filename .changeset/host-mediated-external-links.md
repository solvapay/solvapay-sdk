---
'@solvapay/react': minor
---

Fix outbound links being silently dropped inside MCP app iframes. Hosts whose iframe sandbox omits `allow-popups` — Claude on web and desktop — discard both `<a target="_blank">` and `window.open()`, so "Manage account", hosted checkout, "Reopen checkout", Terms/Privacy, the mandate links and the seller support link all rendered as live controls that did nothing when clicked. Every outbound link the SDK renders now routes through the host's `ui/open-link` request when the host declares the `openLinks` capability, and keeps its native `href` navigation everywhere else (plain web checkout, MCP Inspector, ChatGPT).

Adds `useExternalLinkClick()`, `useOpenExternal()` and `<ExternalLinkProvider>`. `<McpBridgeProvider>` (and therefore `<McpApp>`) mounts the opener automatically from `app.openLink`, so integrators on the turnkey shell get the fix without code changes. Mount `<ExternalLinkProvider>` yourself only when hand-rolling a shell for some other sandboxed host.
