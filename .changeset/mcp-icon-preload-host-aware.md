---
'@solvapay/react': patch
---

**`McpApp` no longer preloads the merchant icon on hosts that paint their own merchant chrome.**

The `<link rel="preload" as="image">` tag is now gated on the same
`HOSTS_WITH_MERCHANT_CHROME` check `<AppHeader>` uses to suppress itself.
On ChatGPT / OpenAI / Claude — where no `<img src={iconUrl}>` ever
mounts to consume the preload — the browser was logging
`preloaded but not used` a few seconds after every tool invocation. The
warning is gone on those hosts; the `<link rel="icon">` favicon is still
inserted unconditionally (browsers silently accept unused favicons, and
some hosts still pick it up for their chrome strip).

The effect is also `hostName`-aware in both directions — if `hostName`
arrives *after* `iconUrl` (handshake-after-bootstrap race), any stale
managed preload tag is removed on the re-run, and a late-arriving
non-chrome hostName still kicks off the preload so the warm-cache fast
path in `<AppHeader>` keeps working (no initials flash on MCP Jam / VS
Code first paint).
