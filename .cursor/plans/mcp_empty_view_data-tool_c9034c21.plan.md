---
name: mcp empty view + drop per-call _meta.ui
overview: Make the MCP App shell render nothing (instead of a "Loading…" card) when the host opens the iframe for a tool whose result isn't a SolvaPay bootstrap, and drop per-call result `_meta.ui` stamping from `buildPayableHandler` / `paywallToolResult` since the descriptor is the spec-canonical trigger for every compliant host.
todos:
  - id: state-wiring
    content: Lift classifyHostEntry result into state (entryKind) + add nonBootstrap flag inside packages/react/src/mcp/McpApp.tsx
    status: pending
  - id: onToolResult-fastpath
    content: In onToolResult, detect non-bootstrap structuredContent, set nonBootstrap=true, resolve the wait, and call app.requestTeardown() early
    status: pending
  - id: render-branches
    content: "Replace the unconditional 'Loading…' card: render null for data-tool / non-bootstrap / timed-out; keep 'Loading…' only for intent-tool and fallback entries"
    status: pending
  - id: react-tests
    content: Add two cases to packages/react/src/mcp/__tests__/McpApp.toolResult.test.tsx covering the empty render + early teardown paths; trim `_meta.ui` from existing paywall/nudge entry fixtures
    status: pending
  - id: drop-payable-handler-meta
    content: Remove paywall + nudge per-call `_meta.ui` stamping in packages/mcp-core/src/payable-handler.ts and delete the local buildNudgeUiMeta helper
    status: pending
  - id: drop-paywall-tool-result-meta
    content: Remove per-call `_meta.ui` stamping in packages/mcp-core/src/paywallToolResult.ts
    status: pending
  - id: deprecate-paywall-meta-helper
    content: Mark buildPaywallUiMeta / PaywallUiMeta exports @deprecated in packages/mcp-core/src/paywall-meta.ts + index.ts and update the README row
    status: pending
  - id: core-tests
    content: Update packages/mcp-core/__tests__/payable-handler.unit.test.ts — drop the two nudge `_meta.ui = { resourceUri, nudge }` assertions, flip the paywall assertion to expect no `_meta.ui`
    status: pending
  - id: changeset
    content: Add a changeset describing the `_meta.ui` drop (minor bump on @solvapay/mcp-core) and the `<McpApp>` empty-view fix (patch on @solvapay/react)
    status: pending
isProject: false
---

## Context

Two unrelated-looking threads converge on the same root cause: the spec. **SEP-1865 / MCP Apps** ([2026-01-26 spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)) declares that hosts open the iframe from the **tool descriptor**'s `_meta.ui.resourceUri` (the `tools/list` advertisement), not from per-call `_meta` on tool results. The tool result is just data for the already-mounted iframe.

That has two consequences for us:

1. Hosts correctly open the iframe for every payable tool call (MCPJam, MCP App Inspector, and — once they finish the handshake — Claude Desktop / ChatGPT). For tool results that aren't SolvaPay bootstraps (Oracle demo tools, any future host-rendered data tool), the iframe should render nothing instead of flashing a "Loading…" card.
2. The per-call `_meta.ui` stamping we do in `buildPayableHandler` / `paywallToolResult` is vestigial — the descriptor advertisement already does the job for every spec-compliant host, and ChatGPT explicitly strips per-call `_meta`. We can drop it without regressing any target host.

## Part A — empty view in `<McpApp>`

### A1. Track the entry classification

In [packages/react/src/mcp/McpApp.tsx](solvapay-sdk/packages/react/src/mcp/McpApp.tsx):

- Add `const [entryKind, setEntryKind] = useState<HostEntryClassification['kind'] | null>(null)` (type re-exported from `./bootstrap`).
- In the bootstrap `useEffect`, after `await app.connect()` call `classifyHostEntry(app)` and `setEntryKind(classification.kind)`. The value is already computed locally — just lift it into state so the render branch can read it.
- Add `const [nonBootstrap, setNonBootstrap] = useState(false)` to remember when we've seen a notification that clearly isn't a SolvaPay bootstrap.

### A2. Short-circuit the wait on a non-bootstrap notification

In `onToolResult` (lines 258–299):

- When `parseBootstrapFromToolResult` throws, inspect the payload. If it has `structuredContent` but no `productRef` and no recognisable paywall/nudge shape (i.e. it's just host-renderable data like the Oracle's `{symbol, direction, confidence, …}`), treat it as "non-bootstrap": `setNonBootstrap(true)`, resolve `firstNotificationApplied`, and fire `app.requestTeardown()` best-effort so teardown-capable hosts unmount immediately instead of after the 2 s timeout.
- Keep today's `console.warn` only for genuinely malformed payloads (no `structuredContent` at all, or an `isError` with text content).

### A3. Swap the render branches

Replace the single "no bootstrap → Loading…" block (lines 525–533) with:

- **Data-tool entry, or non-bootstrap notification seen, or timed out** → return `null`.
- **Intent-tool / fallback entry, still loading** → keep the current "Loading…" card.
- **`initError`** → unchanged; real connect errors still surface the error card.

```tsx
if (initError) { /* unchanged */ }

const showLoading = !bootstrap && entryKind !== 'data' && !nonBootstrap
if (!bootstrap) {
  return showLoading ? (
    <main className="solvapay-mcp-main">
      <div className={cx.card}><p>Loading…</p></div>
    </main>
  ) : null
}
```

### A4. React tests

In [packages/react/src/mcp/__tests__/McpApp.toolResult.test.tsx](solvapay-sdk/packages/react/src/mcp/__tests__/McpApp.toolResult.test.tsx):

- Add a case: data-tool entry (`getHostContext` returns `toolInfo.tool.name = 'predict_direction'`) with no notification → `<McpApp>` renders empty (no "Loading…" text, no error card).
- Add a case: data-tool entry followed by a non-bootstrap notification (`{ structuredContent: { direction: 'up', confidence: 0.8 } }`) → `<McpApp>` renders empty and `app.requestTeardown` was called synchronously (not after the 2 s timeout).

In [packages/react/src/mcp/__tests__/McpApp.paywallEntry.test.tsx](solvapay-sdk/packages/react/src/mcp/__tests__/McpApp.paywallEntry.test.tsx) and [McpApp.nudgeEntry.test.tsx](solvapay-sdk/packages/react/src/mcp/__tests__/McpApp.nudgeEntry.test.tsx):

- Drop the `_meta: { ui: { resourceUri: ... } }` property from the mocked `fireToolResult(...)` payloads. These fixtures were modelling what the server currently sends; once Part B lands the server no longer sends it, and the tests read the bootstrap off `structuredContent` anyway.
- First paywall test currently asserts `expect(screen.getByText('Loading…')).toBeTruthy()` before firing the notification (line 124). That still works because the `search_knowledge` entry is a data-tool entry — so after Part A3, this assertion becomes `expect(screen.queryByText('Loading…')).toBeNull()` (empty render) before the paywall notification flips it to the paywall surface.

Intent-tool loading behaviour is covered by the existing `McpApp.test.tsx` mount tests — reconfirm they still assert the "Loading…" card.

## Part B — drop per-call `_meta.ui` stamping

### B1. `packages/mcp-core/src/payable-handler.ts`

- **Paywall branch (lines 147–170):** stop merging `buildPaywallUiMeta({ resourceUri })` into `_meta`. The branch should still rewrite `structuredContent` into the `BootstrapPayload` with `view: 'paywall'` and still set `isError: false`, but the returned object's `_meta` becomes `existingMeta` passthrough — omit it entirely when `existingMeta` is empty (same pattern the plain success branch already uses at line 269).
- **Nudge branch (lines 254–263):** stop merging `buildNudgeUiMeta({ resourceUri, nudge })` into `_meta`. The `nudge` + `data` already ride on `structuredContent` (that's what the React shell reads), so dropping the `_meta` mirror is lossless. Return the `existingMeta` passthrough conditionally like the non-nudge branch.
- **`buildNudgeUiMeta` helper (lines 280–284):** delete — becomes dead code.
- **Imports:** drop `import { buildPaywallUiMeta } from './paywall-meta'`.
- **`BuildPayableHandlerContext.resourceUri`:** keep the field on the type for backwards compatibility with direct callers (including `registerPayableTool` at [packages/mcp/src/registerPayableTool.ts](solvapay-sdk/packages/mcp/src/registerPayableTool.ts#L169)), but mark it `@deprecated — no longer consumed; descriptor-level _meta.ui drives host rendering` and stop destructuring it inside the function body. Saves a breaking change.
- **JSDoc:** rewrite step 5 of the numbered list and the paragraph-level comments that say "stamps `_meta.ui`" to reflect the descriptor-is-the-trigger reality. The `resourceUri` parameter docstring is rewritten to reflect its @deprecated status.

### B2. `packages/mcp-core/src/paywallToolResult.ts`

- Drop the `_meta: buildPaywallUiMeta({ resourceUri: ctx.resourceUri })` line from the returned object (line 101) so the result carries `isError: false`, `content[0]`, and `structuredContent` only.
- Drop the `buildPaywallUiMeta` import.
- Mark `PaywallToolResultContext.resourceUri` `@deprecated` (same rationale as B1) and stop reading it.
- Update the JSDoc header: "the `_meta.ui` envelope telling the host which resource to open" → "the descriptor-level `_meta.ui.resourceUri` on the tool advertisement tells the host which resource to open; this helper only shapes the gate-response body."

### B3. `packages/mcp-core/src/paywall-meta.ts` + `index.ts`

- Keep the module but annotate `buildPaywallUiMeta`, `PaywallUiMeta`, `PaywallUiMetaInput` as `@deprecated` with a one-line note pointing to the descriptor. Leaves downstream merchants who imported these for their own hand-rolled handlers a one-minor-version grace window instead of breaking them outright.
- No re-export changes in [packages/mcp-core/src/index.ts](solvapay-sdk/packages/mcp-core/src/index.ts#L99-L100) beyond inheriting the deprecation.

### B4. Core tests

In [packages/mcp-core/__tests__/payable-handler.unit.test.ts](solvapay-sdk/packages/mcp-core/__tests__/payable-handler.unit.test.ts):

- **Nudge suite (lines 122–137 + 172–175):** remove both `expect(result._meta).toEqual({ ui: { resourceUri, nudge } })` assertions. Replace the first's `it(...)` title (`'stamps _meta.ui = { resourceUri, nudge } on the response'`) with something like `'embeds nudge + data on structuredContent'` and assert the `structuredContent.nudge` + `structuredContent.data` shape that the nudge branch already produces via `buildBootstrap`.
- **Paywall suite (line 490):** flip `expect(result._meta).toEqual({ ui: { resourceUri } })` to `expect(result._meta).toBeUndefined()` (or the equivalent "does not contain `ui`" matcher). Rewrite the comment block at lines 484–486 to reference descriptor-level `_meta.ui` instead of result-level.
- **Success suite (line 97–98):** `expect(result._meta).toBeUndefined()` is already correct — no change.

[packages/mcp/__tests__/create-solvapay-mcp-server.unit.test.ts](solvapay-sdk/packages/mcp/__tests__/create-solvapay-mcp-server.unit.test.ts) asserts **descriptor-level** `_meta.ui` which is exactly what we're keeping — no changes there.

### B5. Docs + changeset

- [packages/mcp-core/README.md](solvapay-sdk/packages/mcp-core/README.md): update the top-of-file summary ("paywall `_meta.ui` envelope" → "paywall descriptor metadata and `BootstrapPayload` shape") and the `buildPaywallUiMeta` row in the feature table: mark deprecated.
- Add a `.changeset/*.md`: minor bump for `@solvapay/mcp-core` + `@solvapay/mcp` (public API deprecation, behaviour change on `buildPayableHandler` / `paywallToolResult` results), patch bump for `@solvapay/react` (empty-view fix). Changeset body should state: "Per-call result `_meta.ui` stamping is now a no-op — MCP Apps hosts open the widget from descriptor-level `_meta.ui.resourceUri` in `tools/list` per SEP-1865. `buildPaywallUiMeta`, `PaywallUiMeta`, and `PaywallUiMetaInput` are deprecated. Merchants relying on result-level `_meta.ui` as a widget-open trigger should ensure their tool descriptor advertises the UI resource (already automatic via `registerPayableTool`)."

## Files touched

**Runtime:**
- [packages/react/src/mcp/McpApp.tsx](solvapay-sdk/packages/react/src/mcp/McpApp.tsx) — Part A1–A3.
- [packages/mcp-core/src/payable-handler.ts](solvapay-sdk/packages/mcp-core/src/payable-handler.ts) — Part B1.
- [packages/mcp-core/src/paywallToolResult.ts](solvapay-sdk/packages/mcp-core/src/paywallToolResult.ts) — Part B2.
- [packages/mcp-core/src/paywall-meta.ts](solvapay-sdk/packages/mcp-core/src/paywall-meta.ts) — Part B3 (deprecation annotations only).

**Tests:**
- [packages/react/src/mcp/__tests__/McpApp.toolResult.test.tsx](solvapay-sdk/packages/react/src/mcp/__tests__/McpApp.toolResult.test.tsx) — two new cases.
- [packages/react/src/mcp/__tests__/McpApp.paywallEntry.test.tsx](solvapay-sdk/packages/react/src/mcp/__tests__/McpApp.paywallEntry.test.tsx) — strip `_meta` from fixtures, flip the pre-notification assertion.
- [packages/react/src/mcp/__tests__/McpApp.nudgeEntry.test.tsx](solvapay-sdk/packages/react/src/mcp/__tests__/McpApp.nudgeEntry.test.tsx) — strip `_meta` from fixtures.
- [packages/mcp-core/__tests__/payable-handler.unit.test.ts](solvapay-sdk/packages/mcp-core/__tests__/payable-handler.unit.test.ts) — nudge + paywall assertion flips.

**Docs + release:**
- [packages/mcp-core/README.md](solvapay-sdk/packages/mcp-core/README.md) — deprecation note.
- `.changeset/<slug>.md` — new.

## Out of scope

- Descriptor-level `_meta.ui.resourceUri` on `tools/list` — kept; this is the spec-canonical rendering trigger and already always-on via `registerPayableTool` and `buildSolvaPayDescriptors`.
- Adding an `empty` view to `McpViewKind` / `SolvaPayMcpViewKind` — not needed; the empty state is a pre-bootstrap render, not a routed surface.
- Removing `buildPaywallUiMeta` from the public API — deprecated in this change, removed in a future major.
- Touching `requestTeardown` semantics — still best-effort, just invoked one step earlier.
- Revisiting the paywall `isError: false` decision — still correct under the new semantics (descriptor already advertised the widget, but hosts that key on `isError` would skip even rendering the content block).