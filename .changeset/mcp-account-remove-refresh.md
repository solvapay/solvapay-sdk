---
'@solvapay/react': patch
---

Remove the inline refresh icon from the `<McpAccountView>` section label
row. `<McpAppShell>` already re-fetches the bootstrap once on mount, so
the user-visible button was redundant — re-opening the iframe is the
only refresh moment that actually matters in practice.

- `<McpAccountView>` no longer accepts an `onRefresh` prop. The bare
  `CURRENT PLAN AND USAGE` label now sits directly above the plan card.
- `<McpAppShell>` keeps `onRefreshBootstrap` and the mount-time refresh;
  it just stops threading it into the account view.
- Removed `sectionLabelRow` and `refreshButton` slots from
  `McpViewClassNames` and the matching `solvapay-mcp-section-label-row`
  / `solvapay-mcp-refresh-button` CSS rules.
- Removed the `account.refreshLabel` copy key.
