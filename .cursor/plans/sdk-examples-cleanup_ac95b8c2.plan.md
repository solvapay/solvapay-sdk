---
name: sdk-examples-cleanup
overview: Clean up and re-align `examples/` in solvapay-sdk. Orphan `spa-checkout/` has already been deleted from disk. Remaining work is deciding whether to keep or delete the undocumented `shadcn-checkout` and `tailwind-checkout` examples, then fixing documentation drift so every surviving example is discoverable from the README, docs site, and TypeScript project references.
todos:
  - id: decide-composition
    content: "Decide: keep or delete shadcn-checkout + tailwind-checkout (recommendation: keep, they're the only primitive-composition reference)"
    status: pending
  - id: add-composition-readmes
    content: "If keeping: add README.md inside examples/shadcn-checkout and examples/tailwind-checkout (short, positioning-only)"
    status: pending
  - id: update-examples-readme
    content: "Update examples/README.md: add hosted-checkout-demo and (if kept) shadcn-checkout + tailwind-checkout sections"
    status: pending
  - id: update-docs-examples
    content: "Update docs/guides/examples.mdx: add (if kept) shadcn-checkout + tailwind-checkout rows and notes"
    status: pending
  - id: update-root-readme
    content: "Update root README.md examples section: add (if kept) shadcn-checkout + tailwind-checkout entries"
    status: pending
  - id: update-tsconfig-references
    content: "Update tsconfig.with-examples.json: add (if kept) shadcn-checkout + tailwind-checkout to references"
    status: pending
  - id: fix-shared-readme
    content: "Fix examples/shared/README.md: remove mcp-oauth-bridge from the 'Examples Using This' list (it uses @solvapay/demo-services, not the stub)"
    status: pending
  - id: verify-build
    content: "Run pnpm build and pnpm -r --filter='./examples/*' lint to confirm nothing broke"
    status: pending
  - id: open-pr
    content: "Open PR to dev on branch chore/examples-cleanup"
    status: pending
isProject: false
---

# Clean up and re-align `examples/` in solvapay-sdk

## Background

Review of `examples/` surfaced three classes of drift:

1. **Orphan directory** — `examples/spa-checkout/` existed on disk with only `dist/`, `.turbo/`, and `node_modules/`; the tracked sources were already removed from git on `fix/customer-externalref-backfill`. **Already deleted from disk** as part of this task.
2. **Undocumented examples** — `examples/shadcn-checkout/` and `examples/tailwind-checkout/` landed on `feature/sdk-checkout-composition` (commits `ae76203`, `ae76590`) and are tracked, real, and runnable, but appear nowhere in `examples/README.md`, `docs/guides/examples.mdx`, root `README.md`, or `tsconfig.with-examples.json`, and have no README inside.
3. **Stale doc claim** — `examples/shared/README.md` lists `mcp-oauth-bridge` as a consumer of `createStubClient`, but `mcp-oauth-bridge/src/server.ts` only imports from `@solvapay/demo-services`. Only `express-basic` actually consumes the stub client today.

## Current state after orphan deletion

| Folder | In git | `examples/README.md` | `docs/guides/examples.mdx` | root `README.md` | `tsconfig.with-examples.json` |
| --- | --- | --- | --- | --- | --- |
| `checkout-demo` | yes | yes | yes | yes | yes |
| `hosted-checkout-demo` | yes | **no** | yes | yes | yes |
| `express-basic` | yes | yes | yes | yes | yes |
| `mcp-oauth-bridge` | yes | yes | yes | yes | yes |
| `mcp-time-app` | yes | yes | yes | yes | yes |
| `supabase-edge` | yes | yes | no (Deno, by design) | yes | n/a |
| `shared` | yes | yes (stub section) | n/a | n/a | n/a |
| `shadcn-checkout` | yes | **no** | **no** | **no** | **no** |
| `tailwind-checkout` | yes | **no** | **no** | **no** | **no** |

## Decision: keep or delete the composition examples

**Recommendation: keep.**

`checkout-demo` and `hosted-checkout-demo` sell the `<CheckoutLayout>` golden path (the ~50-line integration). The "compose `PlanSelector` + `PaymentForm` + `ActivationFlow` + `AmountPicker` primitives directly" story is a deliberate SDK positioning point — it's mentioned in `packages/react/README.md#custom-composition-pick-the-primitives-you-need` and referenced from both demo READMEs — but it has no runnable reference without these two.

- `tailwind-checkout`: primitives only, Tailwind v4 utilities, no `styles.css` import, `data-[state=X]:` variants. Shows "every pixel owned by the integrator".
- `shadcn-checkout`: primitives composed with shadcn/ui via `asChild`. Shows the most common real-world design-system integration.

They are cheap to keep (under 150 LoC of app code between them) and hard to rebuild. Deleting would leave a gap in the composition docs that `checkout-demo` does not fill.

**If the decision is delete:** skip todos `add-composition-readmes` and every "if kept" todo, and replace `update-examples-readme` / `update-docs-examples` / `update-root-readme` / `update-tsconfig-references` with plain `rm -rf` on the two folders plus pnpm-lock regen.

## Plan — assuming "keep"

### 1. READMEs for the composition examples

Keep them short and positioning-only — the code is the reference. Each should include:

- One-line tagline placing it on the spectrum against `checkout-demo`.
- `pnpm install && pnpm dev` (port 3012 for shadcn, 3011 for tailwind — already in `package.json`).
- Link to the relevant section of `packages/react/README.md` and to `checkout-demo` for the `<CheckoutLayout>` alternative.
- Note that these examples use the stub auth proxy (`x-user-id: demo-user`) and point at `@solvapay/examples-shared` for the dispatcher wiring.

Target length: ~30 lines each. Do **not** duplicate `checkout-demo`'s Supabase / Google OAuth setup — that's an intentional scope difference.

### 2. `examples/README.md`

Add sections mirroring the existing style:

- `### Hosted Checkout Demo (`hosted-checkout-demo`)` — right after `Checkout Demo`, frames it as the "redirect to solvapay.com" counterpart.
- `### Primitive composition — Tailwind (`tailwind-checkout`)` and `### Primitive composition — shadcn/ui (`shadcn-checkout`)` — one block per example, each linking to its README and to the `packages/react` composition section.

Also update the "Development Workflow" section to include the two new `pnpm dev` invocations.

### 3. `docs/guides/examples.mdx`

Extend the "Quick comparison" table with two rows:

| Example | Framework | Checkout type | Auth | Best for |
| --- | --- | --- | --- | --- |
| tailwind-checkout | Next.js | Embedded (primitives) | Stub | Design-system-free composition |
| shadcn-checkout | Next.js | Embedded (primitives) | Stub | shadcn/ui integration reference |

Add matching "Example notes" entries pointing at each folder's README.

### 4. Root `README.md`

Add two short entries after the existing `hosted-checkout-demo` block, matching its format:

```md
### [tailwind-checkout](./examples/tailwind-checkout)

Primitive-only Tailwind v4 composition — every pixel in userspace via `data-[state=X]:` variants.

### [shadcn-checkout](./examples/shadcn-checkout)

Primitives composed with shadcn/ui via `asChild`. Four-file shadcn registry source.
```

### 5. `tsconfig.with-examples.json`

Add references so `tsc -b tsconfig.with-examples.json` covers both:

```json
{ "path": "examples/shadcn-checkout" },
{ "path": "examples/tailwind-checkout" }
```

Confirm each folder's `tsconfig.json` declares `"composite": true` (required for project references). If not, add it.

### 6. `examples/shared/README.md`

Under "Examples Using This", drop `mcp-oauth-bridge` — it imports `@solvapay/demo-services`, not `createStubClient`. Leaves only `express-basic`. Optionally, add a sentence noting that `examples-shared/next-stub.ts` is consumed by `shadcn-checkout` and `tailwind-checkout` for the Next.js route dispatcher wiring, which is the actual other real use of this package.

### 7. Verify

```bash
pnpm install
pnpm -w build
pnpm -r --filter='./examples/*' lint
tsc -b tsconfig.with-examples.json
```

No runtime changes, so no new tests. The build and TypeScript project references are the check that the new refs resolve.

### 8. PR

Branch: `chore/examples-cleanup` off `dev`. Single PR covering:

- `git rm -r` of `examples/spa-checkout/` (already deleted on disk, just needs to stick in the commit).
- New READMEs and doc edits above.
- `tsconfig.with-examples.json` update.
- `examples/shared/README.md` fix.

Commit messages (one per logical change):

- `chore(examples): drop spa-checkout orphan dir`
- `docs(examples): add READMEs + registry entries for shadcn-checkout and tailwind-checkout`
- `docs(examples): list hosted-checkout-demo in examples/README.md`
- `docs(shared): remove mcp-oauth-bridge from stub-client consumer list`

## Out of scope

- Merging `checkout-demo` and `hosted-checkout-demo` — they model genuinely different integration paths (embedded Stripe Elements vs redirect to `solvapay.com`) and the split is intentional.
- Rewriting the long troubleshooting sections in `checkout-demo/README.md` and `hosted-checkout-demo/README.md` — they duplicate Supabase/Google OAuth content, but that's a separate docs-consolidation task.
- Trimming `@solvapay/demo-services` vs `@solvapay/examples-shared` overlap — both are workspace-only; collapsing is plausible but out of scope here.
- Any change to `supabase-edge` (Deno reference project, intentionally not a Node workspace member).

## Risk

- Very low. All changes are docs, one README file per example, and a tsconfig references update. No runtime or published-package surface moves.
- Only thing to watch: if either `shadcn-checkout` or `tailwind-checkout` `tsconfig.json` is missing `"composite": true`, adding it to `tsconfig.with-examples.json` references will fail the build. Easy fix if it trips.
