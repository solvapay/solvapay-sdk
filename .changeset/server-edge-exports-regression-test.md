---
'@solvapay/server': patch
---

**Broader regression guard for the `@solvapay/server` edge
entrypoint.**

Adds `packages/server/src/__tests__/edge-exports.test.ts` — a smoke
test that imports every symbol `@solvapay/mcp-core` /
`@solvapay/mcp-fetch` pull through their top-level
`@solvapay/server` import and asserts each one resolves on `./edge`.
Complements the existing `__tests__/edge-exports.unit.test.ts`
(scoped to `*Core` route helpers consumed by `@solvapay/fetch`).

Prevents a recurrence of the Goldberg boot crash where
`@solvapay/mcp-core@0.2` started importing `buildNudgeMessage` +
`isPaywallStructuredContent` from `@solvapay/server`; those lived
only in `src/index.ts`, so Deno's `deno` export condition resolved
to `dist/edge.js` and crashed at module-load time with `does not
provide an export named 'buildNudgeMessage'`.

Ships alongside the `server-edge-exports` changeset so the fix +
regression guard land in the same release.
