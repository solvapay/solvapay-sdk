/**
 * Narrated overview for the SolvaPay MCP server — served verbatim at
 * `docs://solvapay/overview.md` so agents can `resources/read` before
 * calling any tool.
 *
 * Inlined as a TS constant (not a standalone `.md` file) because the
 * package bundles via tsup — a markdown asset next to this file would
 * need copy-on-build and runtime `fs` access, neither of which the
 * framework-neutral `@solvapay/mcp` package should take on.
 */

export const SOLVAPAY_OVERVIEW_URI = 'docs://solvapay/overview.md'
export const SOLVAPAY_OVERVIEW_MIME_TYPE = 'text/markdown'

export const SOLVAPAY_OVERVIEW_MARKDOWN = `# SolvaPay MCP server — overview

This MCP server connects a SolvaPay-protected product to your host so users can
manage their plan, usage, and billing **without leaving the chat**. It is
dual-audience: every tool returns a UI bootstrap for hosts that render MCP UI
resources (\`basic-host\`, Claude Desktop, ChatGPT, etc.) and a markdown summary
with clickable URLs for text-only hosts.

## What the user can do

- **Upgrade** — start or change a paid plan. \`/upgrade\` opens the embedded
  checkout (Stripe Elements inline) on UI hosts and returns a hosted-checkout
  URL on text hosts.
- **Manage account** — current plan, balance, payment method, cancel or
  reactivate auto-renewal. \`/manage_account\`.
- **Top up credits** — add SolvaPay credits for usage-based plans.
  \`/topup\`.
- **Check usage** — used / remaining / reset date for the active usage-based
  plan. \`/check_usage\`.
- **Activate plan** — pick a plan from the list or activate a specific plan
  by \`planRef\`. Free plans activate immediately, usage-based plans activate
  when balance covers the configured usage, paid plans return the embedded
  checkout or a hosted-checkout URL. \`/activate_plan\`.

## How it fits together

Each intent tool returns a full \`BootstrapPayload\` (merchant + product + plans
+ customer snapshot) so the embedded UI never fires per-view read calls. When
a paywalled data tool hits the usage limit, its response carries the same
payload with \`view: "paywall"\`, letting the host open the UI directly on the
paywall screen — no second tool call required.

Auth is handled by the SolvaPay OAuth bridge (see \`createMcpOAuthBridge\`). The
bridge injects \`customer_ref\` onto every authenticated request; tools that
need an authenticated caller return \`Unauthorized\` when it is missing.

## Also see

- \`docs://solvapay/overview.md\` (this resource) — agent-facing narration.
- \`ui://<app>/mcp-app.html\` — the embedded UI shell.
- \`tools/list\` + \`prompts/list\` — programmatic discovery of the intent tools
  and their slash-command shortcuts.
- Documentation: https://docs.solvapay.com/sdks/typescript/guides/mcp-app.
`
