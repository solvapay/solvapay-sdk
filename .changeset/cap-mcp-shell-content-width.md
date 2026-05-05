---
'@solvapay/react': patch
---

Fix `<McpApp>` shell content width on wide-iframe hosts. The previous CSS-only "fill iframe width" change removed the `max-width: 520px` cap from `.solvapay-mcp-main` so unbounded-iframe hosts (MCP Inspector, MCP Jam, full-browser previews) could use the column they hand us, but it overshot — at iframe widths beyond ~700px the AppHeader, body card, and LegalFooter all stretched to the iframe edges, splaying receipt rows with hundreds of pixels of dead air, blowing up the `width: 100%` button to ~800px, and producing >95-character body-copy line lengths.

Re-introduce a single `max-inline-size: 520px` on `.solvapay-mcp-main` so the whole shell renders as one visually unified block centred in the iframe. The earlier `@media (min-width: 900px) { max-width: 960px }` sidebar-mode override is intentionally not carried forward — it was the cause of the felt-cramped problem on 1200px+ iframes.

Also convert the wide-shell sidebar `@media (min-width: 900px)` query (`.solvapay-mcp-shell-sidebar` + `.solvapay-mcp-shell-layout` grid switch) to a `@container (min-width: 900px)` query, with `container-type: inline-size` on `.solvapay-mcp-main`. Without this, the sidebar grid would still fire on iframe viewport width — meaning at iframe widths ≥900px the `1fr + 320px` grid would activate inside the 520px capped shell, squeezing the body column to ~184px and breaking payment forms. Container queries fire on the shell's own width, so the sidebar correctly never activates inside the default cap.

Below 520px (Claude Desktop ~400-500px, ChatGPT inline ~400px, Mobile Claude ~300-360px) the cap is a no-op and content fills the host's container, matching Anthropic's "apps fill the container width" guidance for the primary use cases. Above 520px the cap activates.

Source-grounded basis for 520:

- SEP-1865 §"Container Dimensions" — when the host omits `containerDimensions.width`/`maxWidth` (Unbounded mode) the spec delegates the size choice to the View.
- OpenAI Apps SDK guidelines mandate "set a max width and design layouts that collapse gracefully on small screens".
- OpenAI's `apps-sdk-ui` reservation card uses `max-w-sm` (384px); `openai-apps-sdk-examples` cluster sits at 220-360px.
- Anthropic's PRIMARY use case is Desktop Claude at 400-500px. 520 is a small composite-flow buffer above that range — our `PlanStep → AmountStep → PaymentStep → SuccessStep` is slightly larger than a single-tool inline card.
- At our 14px body, 520px ≈ 62ch — inside the 65-75ch optimal reading line length.
