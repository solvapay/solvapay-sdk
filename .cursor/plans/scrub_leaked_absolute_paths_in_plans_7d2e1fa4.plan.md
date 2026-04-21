---
name: scrub leaked absolute paths in plan files
overview: Resolve the Low-Severity Bugbot finding blocking solvapay-sdk release PR #117 (`main` enforces `required_conversation_resolution`). Four `.cursor/plans/*.plan.md` files contain ~25 absolute paths rooted at `<HOME>/...`. Replace same-repo paths with repo-relative ones, replace cross-repo paths with GitHub URLs, and replace the global `<HOME>/.cursor/plans/...` reference with a plain plan name. This unblocks the dev→main release.
todos:
  - id: oauth-bridge-plan
    content: "`.cursor/plans/sdk_oauth_bridge_full_proxy_842b5cd9.plan.md`: rewrite 6 leaked paths (same-repo → relative; backend/docs/website → GitHub URLs). Includes the fenced code-reference block on line 47."
    status: pending
  - id: headless-v2-plan
    content: "`.cursor/plans/sdk_headless_v2_sdk-only_d067ca0f.plan.md`: rewrite 3 leaked paths (in-scope root → relative; docs + website refs → GitHub URLs)."
    status: pending
  - id: smoke-gate-plan
    content: "`.cursor/plans/example_smoke_preview_gate.plan.md`: rewrite 8 leaked paths (examples/* → relative; cross-repo → GitHub URLs; `<HOME>/.cursor/plans/go_live_preview_for_lovable_*.plan.md` → plain plan-name mention since it lives outside any repo)."
    status: pending
  - id: lovable-gaps-plan
    content: "`.cursor/plans/sdk_gaps_for_lovable_skill_0be93609.plan.md`: rewrite 8 leaked paths (same-repo → relative; note that some sibling plans incorrectly reference the old `solvapay-frontend/.cursor/plans/` location — update those to `solvapay-sdk/.cursor/plans/` or, if the plan was migrated away, drop the link and keep the name only)."
    status: pending
  - id: verify
    content: "Run `rg -n '/Users/' .cursor/plans/` and `rg -n 'solvapay/solvapay-(frontend|sdk)/\\.cursor/plans' .cursor/plans/` — both must return zero matches. Visually confirm no committed plan links are broken in GitHub's markdown render."
    status: pending
  - id: land
    content: "Commit as `docs(plans): scrub leaked local filesystem paths`, open PR to `dev`. After merge, mark the Bugbot conversation on #117 as resolved so its `mergeStateStatus` flips from BLOCKED to CLEAN, then merge the release PR."
    status: pending
isProject: false
---

# Scrub leaked absolute paths in plan files (PR #117 Bugbot blocker)

## Context

[solvapay-sdk #117](https://github.com/solvapay/solvapay-sdk/pull/117) (release `dev → main`) currently sits at `mergeStateStatus: BLOCKED` despite all required status checks passing. `main` has `required_conversation_resolution: true` and one Bugbot thread is unresolved.

The finding: four committed `.cursor/plans/*.plan.md` files contain absolute paths rooted at `<HOME>/`, which expose a developer's home directory, are non-functional for any other contributor, and render as broken links in GitHub's markdown preview.

`rg -n '<HOME>/' .cursor/plans/` confirms ~25 occurrences across these four files:

| File | Leaks |
|------|-------|
| `sdk_oauth_bridge_full_proxy_842b5cd9.plan.md` | 6 |
| `sdk_headless_v2_sdk-only_d067ca0f.plan.md` | 3 |
| `example_smoke_preview_gate.plan.md` | 8 |
| `sdk_gaps_for_lovable_skill_0be93609.plan.md` | 8 |

## Replacement rules

Apply in order. Every committed plan lives in a repo — resolve paths relative to that repo root.

1. **Same-repo reference** (`<HOME>/projects/solvapay/solvapay-sdk/<x>`): replace with the repo-relative path `<x>`. Example:
   - Before: `` [`packages/react/package.json`](<HOME>/projects/solvapay/solvapay-sdk/packages/react/package.json) ``
   - After:  `` [`packages/react/package.json`](packages/react/package.json) ``
2. **Cross-repo reference** (`<HOME>/projects/solvapay/<other-repo>/<x>`): replace with a GitHub URL pinned to `main`. Example:
   - Before: `[authorization-server.controller.ts](<HOME>/projects/solvapay/solvapay-backend/src/auth/controllers/customer/authorization-server.controller.ts)`
   - After:  `[authorization-server.controller.ts](https://github.com/solvapay/solvapay-backend/blob/main/src/auth/controllers/customer/authorization-server.controller.ts)`
3. **Home-global plan** (`<HOME>/.cursor/plans/<file>.plan.md`): drop the link — these plans live outside any repo and are not accessible to anyone else. Keep the human-readable name only. Example:
   - Before: `The [go-live preview for Lovable plan](<HOME>/.cursor/plans/go_live_preview_for_lovable_f6111d29.plan.md) shipped...`
   - After:  `The go-live preview for Lovable plan shipped...`
4. **Fenced code-reference header** (`` ```<start>:<end>:<HOME>/.../file.ts ``): replace the path segment with the repo-relative path. Only `sdk_oauth_bridge_full_proxy_842b5cd9.plan.md:47` currently matches this pattern.
   - Before: `` ```85:103:<HOME>/projects/solvapay/solvapay-sdk/packages/server/src/mcp/oauth-bridge.ts ``
   - After:  `` ```85:103:packages/server/src/mcp/oauth-bridge.ts ``
5. **Stale cross-repo plan locations**: `sdk_gaps_for_lovable_skill_0be93609.plan.md` references three plans as living in `solvapay/solvapay-frontend/.cursor/plans/` that were migrated to `solvapay-sdk/.cursor/plans/` by commit `9fcce8b8` (`chore(plans): migrate SDK plans to solvapay-sdk repo`). Update those to the new in-repo location using rule 1.
   - Affected lines: 94, 345, 379.

## Per-file change list

### `sdk_oauth_bridge_full_proxy_842b5cd9.plan.md`

| Line | Action |
|------|--------|
| 45 | Rule 1 — same-repo `packages/server/src/mcp/oauth-bridge.ts`. |
| 47 | Rule 4 — code fence header to `85:103:packages/server/src/mcp/oauth-bridge.ts`. |
| 95 | Rule 2 — GitHub URL into `solvapay-backend`. |
| 134 | Rule 1 — same-repo `docs/guides/mcp.mdx`. |
| 135 | Rule 1 — same-repo `examples/mcp-oauth-bridge/README.md`. |
| 139 | Rule 2 — GitHub URL into `solvapay-backend`. |

### `sdk_headless_v2_sdk-only_d067ca0f.plan.md`

| Line | Action |
|------|--------|
| 40 | Rule 1 — drop path altogether; "all in this repo" is implicit. Keep the bullet but remove the link. |
| 57 | Rule 2 — "live in [`solvapay/docs`](https://github.com/solvapay/docs)". |
| 59 | Rule 2 — "lives in [`solvapay/solvapay-website`](https://github.com/solvapay/solvapay-website)". |

### `example_smoke_preview_gate.plan.md`

| Line | Action |
|------|--------|
| 36 | Rule 3 — drop link, keep plan name. |
| 51-56 | Rule 1 — six `examples/<name>` same-repo rewrites. |
| 94 | Rule 2 — GitHub URL into `solvapay-frontend` **or** update to `solvapay-sdk` if the referenced plan has been migrated (check `rg -l sdk_gaps_for_lovable_skill_0be93609 .cursor/plans`). Migrate-aware rewrite preferred. |

### `sdk_gaps_for_lovable_skill_0be93609.plan.md`

| Line | Action |
|------|--------|
| 41 | Rule 1 — `packages/react/package.json`, `packages/react/src/styles.css`. |
| 62 | Rule 1 — `examples/tailwind-checkout`, `examples/shadcn-checkout`. |
| 66 | Rule 1 — `packages/react/README.md`. |
| 140 | Rule 1 — `examples/supabase-edge`. |
| 345 | Rules 1 + 5 — update stale `solvapay-frontend/.cursor/plans/…` → in-repo `.cursor/plans/sdk_headless_v2_sdk-only_d067ca0f.plan.md`. |
| 373 | Rule 1 — `examples/supabase-edge/supabase/functions/deno.json`. |
| 379 | Rules 1 + 5 — in-repo `.cursor/plans/lovable-checkout_preview_skill_0936277f.plan.md` (verify this one exists in the sdk repo; if it lives only in the frontend repo, use Rule 2 GitHub URL). |
| 393 | Rule 1 — `examples/supabase-edge/README.md`. |
| 451 | Rules 1 + 5 — same as line 345. |

## Verification

Run from the sdk repo root:

```bash
rg -n '/Users/' .cursor/plans/              # must return nothing
rg -n 'solvapay-frontend/\.cursor/plans' .cursor/plans/  # must return nothing
```

Also preview the four files on the PR branch in GitHub's markdown view to confirm none of the newly-rewritten links 404.

## Delivery

1. Branch `bugfix/scrub-leaked-plan-paths` off `dev`.
2. Single commit: `docs(plans): scrub leaked local filesystem paths`.
3. Open PR to `dev`. Small, low-risk, docs-only; should merge quickly.
4. After the fix lands on `dev`, the release PR #117 will pick it up automatically (its head is `dev`). Resolve the Bugbot conversation on #117 — this flips `mergeStateStatus` from `BLOCKED` to `CLEAN`, and the release is ready to merge.

## Out of scope

- The Bugbot finding is about the plan files only. Don't touch plans under other repos — each of the other release PRs (`solvapay-frontend`, `solvapay-backend`, `docs`, `cursor-plugin`, `skills`) is independently CLEAN.
- Don't introduce tooling (pre-commit hook, path sanitiser) in this PR. If the leak recurs, that's a separate follow-up.
