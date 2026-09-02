# SDK build / regen / test — fix plan

Actionable plan derived from the 2026-08-29 command run (logs: `/tmp/solvapay-sdk-cmd-run/`).
Original findings are preserved per item under **Symptom**.

Decisions taken: full pnpm major upgrade (not a dual-declare workaround), and full
scope including example apps.

---

## Corrections to the original findings

Two items were diagnosed wrong on first pass. Both would have caused damage if
actioned literally.

### `pnpm.overrides` is still being applied today

The Next `16.2.7` pin is **not** broken. Homebrew ships pnpm `11.15.0`, which prints the
deprecation warning and then delegates to `pnpm@9.6.0` from `packageManager`. The inner
9.6.0 reads `pnpm.overrides` normally:

```
$ pnpm config list
[WARN] The "pnpm" field in package.json is no longer read by pnpm ...
user-agent=pnpm/9.6.0 npm/? node/v26.5.0 darwin arm64
$ node -p "require('next/package.json').version"   # via .pnpm store
16.2.7
```

`overrides` in `pnpm-workspace.yaml` requires pnpm >= 10.6. Moving the key there **while
staying on 9.6.0 would silently drop the pin** — a masked failure. The pin must move only
as part of the version bump, in the same commit.

### The `sdks/node-native` diff must NOT be committed

`git status` shows `index.d.ts` (+143 lines, a whole `NativeClient` class), `index.js`,
`server-native.wasi-browser.js`, and `server-native.wasi.cjs` modified. These are *not*
stale committed artifacts:

- The manifest generator for `nodeNativeNapi` is the **WASI** target
  ([contract/manifest/repo-paths.yaml](contract/manifest/repo-paths.yaml) line 348):
  `npx napi build --platform --release --target wasm32-wasip1-threads`
- `NativeClient` is **host-native only** — `sdks/node-native/src/lib.rs:6`:
  "WASI builds omit NativeClient"
- `pnpm build:native` runs the **host** target (`napi build --platform --release`,
  [tools/shared/surfaces.ts](tools/shared/surfaces.ts)), producing a superset

So the local rebuild is a host-target artifact overwriting the canonical WASI-target one.
Committing it would break the `node-binding-wasi` CI drift gate
([.github/workflows/ci.yml](.github/workflows/ci.yml) line 823). **Revert these four files.**

---

## P0 — pnpm 9.6.0 -> 11.x migration

**Symptom:** `The "pnpm" field in package.json is no longer read by pnpm. The following
keys were ignored: "pnpm.overrides".` on every `pnpm *` invocation.

This must land as one atomic commit; a partial migration drops the `next` pin.

### 1. Move settings into `pnpm-workspace.yaml`

[pnpm-workspace.yaml](pnpm-workspace.yaml) currently holds only `packages:`. Target:

```yaml
packages:
  - 'sdks/typescript/*'
  - 'sdks/*'
  - 'tools/*'
  - 'internal/*'
  - 'examples/typescript/*'

overrides:
  next: 16.2.7

# pnpm 10 flipped the default to false; the repo relies on true.
linkWorkspacePackages: true

# pnpm 10 blocks dependency lifecycle scripts unless allow-listed.
onlyBuiltDependencies:
  - '@google/genai'
  - esbuild
  - protobufjs
  - sharp
  - workerd
```

The `onlyBuiltDependencies` list was derived by scanning `node_modules/.pnpm` for packages
declaring `install`/`postinstall`/`preinstall`. Confirm against pnpm's own report after the
first install — pnpm 10+ prints exactly which builds it skipped, and `pnpm approve-builds`
regenerates the list interactively. **Do not** accept a green install with skipped builds:
`esbuild` and `workerd` are non-functional without their postinstall.

### 2. Remove the superseded declarations

- [package.json](package.json) lines 31-35: delete the entire `"pnpm"` block.
- [package.json](package.json) line 6: `"packageManager": "pnpm@11.15.0"` (matches the
  local Homebrew install; pick the exact current 11.x and include the integrity hash if
  Corepack is later enabled).
- `.npmrc` (gitignored; also update [.npmrc.example](.npmrc.example) if it carries the key):
  remove `link-workspace-packages=true`. Keep `access=public` and `provenance=false` —
  both are valid npm keys and produce no warning.

### 3. Unpin pnpm in CI — 13 sites across 4 workflows

`pnpm/action-setup@v6` reads `packageManager` when `version:` is omitted, and **errors** if
the two disagree. Rather than editing 13 duplicated version numbers, delete the `with:
version: 9.6.0` input at every site so `packageManager` is the single source of truth:

- [.github/workflows/ci.yml](.github/workflows/ci.yml) — lines 37, 188, 801, 861, 1058,
  1128, 1190, 1328, 1437, 1531
- [.github/workflows/publish.yml](.github/workflows/publish.yml) — line 86
- [.github/workflows/publish-preview.yml](.github/workflows/publish-preview.yml) — line 46
- [.github/workflows/live-python.yml](.github/workflows/live-python.yml) (and the other `live-*.yml` drivers)

### 4. Regenerate the lockfile

`pnpm install` will rewrite [pnpm-lock.yaml](pnpm-lock.yaml) (currently
`lockfileVersion: '9.0'`) and relocate the `overrides:` block into `settings:`. Commit the
result. Verify the pin survived:

```bash
rm -rf node_modules && pnpm install
node -p "require('next/package.json').version"   # must print 16.2.7
grep -A2 '^overrides:' pnpm-lock.yaml
```

### 5. Kill the npm env-config warnings

**Symptom:** `Unknown env config "devdir"` / `"link-workspace-packages"` — "This will stop
working in the next major version of npm."

`link-workspace-packages` is fixed by step 2. `devdir` comes from the Cursor sandbox
(`npm_config_devdir=…/cursor-sandbox-cache/…/node-gyp`), not from repo config — it can only
surface when npm itself runs. Both disappear if we stop shelling out to npm:

- [sdks/typescript/server/scripts/generate-types.ts](sdks/typescript/server/scripts/generate-types.ts)
  line 17: `npx openapi-typescript …` -> `pnpm exec openapi-typescript …`
- [.github/workflows/ci.yml](.github/workflows/ci.yml) line 111: `npx tsc` -> `pnpm exec tsc`

Confirm `openapi-typescript` is a devDependency of `@solvapay/server` first; `pnpm exec`
will not silently fall back to a registry fetch the way `npx` does. Add it if absent.

Leave `npx napi …` in the `nodeNativeNapi` generator and its CI job alone — that job runs
`npm ci` deliberately and changing the generator string would invalidate the manifest.

---

## P0 — Ruby native pipeline

### 1. `Bundler::GemNotFound` — missing `bundle install`

**Symptom:** `bundle exec rake compile` / `rake test` in `sdks/ruby` fail with
`Could not find minitest-5.27.0, rake-13.4.2, rake-compiler-1.3.1, rb_sys-0.9.128, …`.
Failed tasks: `Ruby prepare`, `Ruby`, `Ruby MCP compile binding`.

**Root cause:** [tools/shared/surfaces.ts](tools/shared/surfaces.ts) never runs
`bundle install` in `sdks/ruby`. CI does
([.github/workflows/ci.yml](.github/workflows/ci.yml) lines 558-559), so this only bites
locally. `Gemfile.lock` is committed but gems are not vendored, and `sdks/ruby-mcp` already
has a `ruby-mcp.bundle` task doing exactly this for its own directory.

**Fix:** add a `ruby.bundle` task (`bundle install`, cwd `rubyCwd`) and sequence it ahead of
`ruby.build`, `ruby.prepare`, and `ruby-mcp.compile`. Mirror the existing `python-mcp.prepare`
(`uv sync --extra dev`) pattern so the surfaces stay symmetrical.

Extend [tools/repo/test-all.test.ts](tools/repo/test-all.test.ts) with an assertion that the
`ruby` and `ruby-mcp` prepare lists contain `bundle install` before any `rake compile`.

### 2. `undefined method 'REVERSE_CHARGE_NOTE'` — stale compiled extension

**Symptom:** load crash in `sdks/ruby-mcp` and `examples/ruby/paid_mcp`:
`undefined method 'REVERSE_CHARGE_NOTE' for module SolvaPay::Native`, via
`helpers.generated.rb:8` -> `NativeDispatch.call_sync("REVERSE_CHARGE_NOTE", {})` ->
`_native.rb:180`. Failed tasks: `Ruby MCP`, `Ruby paid-MCP example`.

**Root cause:** `sdks/ruby/lib/solvapay/solvapay.bundle` (gitignored, built Aug 29 16:05)
predates the regenerated Ruby sources (Aug 29 20:39). The old binary registers 87 methods
and does not include `REVERSE_CHARGE_NOTE`, while `helpers.generated.rb` evaluates it at
require time. `pnpm gen` regenerates Ruby sources but does not recompile the Magnus
extension, and the recompile that would have fixed it was itself blocked by (1).

The Rust side is correct and already committed:
`ext/solvapay/src/register.rs:339` defines the singleton method,
`core/solvapay-core/src/tax_summary.rs:9` holds the constant.

**Fix:** (1) resolves this transitively. Recompile:

```bash
cd sdks/ruby && bundle install && bundle exec rake compile
RUBYLIB=$PWD/lib ruby -e 'require "solvapay"; puts SolvaPay::REVERSE_CHARGE_NOTE'
```

**Also harden the failure mode.** The current error names a single missing method and gives
no hint that the cause is a stale binary — it reads like a codegen bug. `lib/solvapay.rb`
already has a `_check_version_skew` hook; add a load-time assertion there that
`NativeDispatch::SYNC_METHODS` is a subset of `SolvaPay::Native.singleton_methods`, raising
a message that names the drift and the remedy (`bundle exec rake compile`). This turns a
confusing symptom into a loud, self-explaining failure rather than papering over it.

---

## P1 — `@solvapay/react` type drift

**Symptom:** `pnpm typecheck` exit 2, from
`sdks/typescript/react/__tests__/tsconfig.types.json` only.

All 31 affected tests **pass under vitest** — this is purely compile-time. Note the gate
gap: CI's `pnpm test:types` at [.github/workflows/ci.yml](.github/workflows/ci.yml) line 116
runs with `working-directory: sdks/typescript/server`, and root `pnpm typecheck` runs in
neither CI nor `.husky/pre-push` (`pnpm gates`). Nothing would have caught this.

### `BalanceStatus` — 2 sites (TS2739: `displayMinorUnits`, `minorUnitsPerMajor`)

A helper already exists and already returns both fields:
[sdks/typescript/react/src/test-helpers/mockBalanceStatus.ts](sdks/typescript/react/src/test-helpers/mockBalanceStatus.ts).
Both failures are hand-rolled inline mocks that bypass it. Route them through it:

- `src/mcp/views/__tests__/McpTopupView.test.tsx:112` ->
  `mockBalanceStatus({ credits: 1000, displayCurrency, creditsPerMinorUnit: 100, displayExchangeRate: 1 })`
- `src/primitives/TopupForm.return.test.tsx:53` — delete the local `mockBalance()` function
  entirely, call `mockBalanceStatus()`

### `PaywallStructuredContent` — 18 sites (TS2322: `shortMessage`)

Add `src/test-helpers/mockPaywallContent.ts` alongside `mockBalanceStatus.ts`, defaulting
`shortMessage` from the discriminant. The input type must make only `shortMessage` optional
while preserving the union — a distributive conditional does this without any assertion:

```ts
import type { PaywallStructuredContent } from '@solvapay/server'

type ShortMessageOptional<T> = T extends unknown
  ? Omit<T, 'shortMessage'> & { shortMessage?: string }
  : never

const DEFAULT_SHORT_MESSAGE: Record<PaywallStructuredContent['kind'], string> = {
  payment_required: 'Payment required',
  activation_required: 'Activation required',
}

export function mockPaywallContent(
  input: ShortMessageOptional<PaywallStructuredContent>,
): PaywallStructuredContent {
  return { shortMessage: DEFAULT_SHORT_MESSAGE[input.kind], ...input } as PaywallStructuredContent
}
```

Defaults match the Rust source of truth, `PaywallGateKind::short_message()` in
[core/solvapay-core/src/paywall_gate.rs](core/solvapay-core/src/paywall_gate.rs).

Replace the inline literals at `src/hooks/__tests__/usePaywallResolver.test.tsx` (61, 74,
96, 114, 133, 152) and `src/primitives/PaywallNotice.test.tsx` (286, 303, 323, 340, 362,
390, 420, 446, 471, 489, 508, 566).

### Remove the casts that hid this

Per the no-masking rule, the existing `as PaywallStructuredContent` escapes are the reason
the drift spread. Route them through the helper too:

- `sdks/typescript/react/src/primitives/checkout/index.test.tsx:823`
- `sdks/typescript/server/__tests__/paywall-state.unit.test.ts:19` — its `gate()` helper
  casts specifically to dodge `shortMessage`

### Close the gate gap

Add root `pnpm typecheck` as a CI step (it already covers every package via
[tools/repo/typecheck-packages.ts](tools/repo/typecheck-packages.ts)). Do this **last**, after
the fixes above are green, so it does not land red.

---

## P1 — working-tree generated artifacts

**Symptom:** `pnpm gates` / `generated:external` warn on hash mismatch for `wasmPkg`
(edge + browser) and `goCoreWasm` vs
[contract/manifest/generated-binaries.sha256](contract/manifest/generated-binaries.sha256).

Both entries are `nonDeterministic: true`, so `gates` (which runs `--markers-only`) warns
rather than fails. Per the comments in
[contract/manifest/repo-paths.yaml](contract/manifest/repo-paths.yaml) lines 353-359, the
`.wasm` blobs are not bit-stable across darwin vs linux/amd64, and the canonical bytes come
from a linux build. Local macOS rebuild drift is expected and must **not** be recorded.

Disposition per path:

- **Revert — `wasmPkg`.** `sdks/wasm/pkg/{browser,edge}/*` (blobs plus the two edge JS/dts
  files, whose only diff is wasm-bindgen closure symbol renames like
  `h83695bada2fdd54b` -> `hf82478b34f74c087`). No source change, so `git checkout`.
- **Revert — `goCoreWasm`.** `sdks/go/solvapay_core.wasm`. Same reasoning.
- **Revert — `nodeNativeNapi`.** `sdks/node-native/{index.d.ts,index.js,server-native.wasi-browser.js,server-native.wasi.cjs}`.
  See the correction at the top: host-target output overwriting the canonical WASI artifact.
- **Rebuild, then decide — `mcpAppWidget`.** The six `mcp-app.html` copies changed together
  (761,581 -> 760,492 bytes) and remain byte-identical to each other, so CI's
  `verifyCommand` (`tools/mcp-app-widget/check.ts`, cross-copy equality only) passes either
  way. Revert, then re-run `pnpm generated:external --rebuild --id mcpAppWidget`; if the
  diff reproduces from committed sources the vendored copies were stale and should be
  committed.
- **Commit — `next-env.d.ts` (5 examples).** Next 16 moved route types from
  `./.next/dev/types/routes.d.ts` to `./.next/types/routes.d.ts`. Next-managed, tracked,
  and correct.

```bash
git checkout -- sdks/go/solvapay_core.wasm sdks/wasm/pkg/ \
  sdks/node-native/index.d.ts sdks/node-native/index.js \
  sdks/node-native/server-native.wasi-browser.js sdks/node-native/server-native.wasi.cjs
```

**Prevent the recurrence.** That `pnpm build:native` silently overwrites four tracked
WASI artifacts with host-target output is a live trap — the obvious reaction (commit the
diff) breaks CI. Document it in
[docs/contributing/testing.md](docs/contributing/testing.md): `build:native`/`test:native`
dirty `sdks/node-native/` and the wasm blobs, and the tree must be restored before pushing.

---

## P1 — package-level warnings

### Turbo: "no output files found"

**Symptom:** warnings for `@solvapay/server-native#build` and `@solvapay/server-wasm#build`.
Neither writes to the root `outputs` globs in [turbo.json](turbo.json) line 18
(`dist/**`, `.next/**`, `generated/**`).

Do **not** fix this by inventing output globs. `@solvapay/server-native`'s build writes
tracked files (`index.d.ts`, `index.js`) — letting turbo cache and restore them would
reintroduce exactly the host-vs-WASI corruption above, non-deterministically. And
`@solvapay/server-wasm`'s `build` is `node scripts/check-artifacts-present.mjs`, a presence
check that writes nothing at all.

Add per-package overrides declaring the truth:

```json
"@solvapay/server-native#build": { "dependsOn": ["^build"], "cache": false },
"@solvapay/server-wasm#build": { "dependsOn": ["^build"], "cache": false }
```

### `@solvapay/mcp` — `empty-import-meta` in the CJS bundle

**Symptom:** tsup warns at `src/defaultMcpAppHtml.ts:6` (`import.meta.url` is empty in CJS).
The CJS build is genuinely consumed (`"require": "./dist/index.cjs"`), and the code throws
on an empty module URL, so this is a real runtime break for CJS consumers, not cosmetic.

Add `shims: true` to
[sdks/typescript/mcp/tsup.config.ts](sdks/typescript/mcp/tsup.config.ts). This is the
established pattern — [sdks/typescript/server/tsup.config.ts](sdks/typescript/server/tsup.config.ts)
line 19 already does exactly this for the same `createRequire(import.meta.url)` shape in
`native.ts`.

### `@solvapay/react` — unused eslint-disable

**Symptom:** unused `react-hooks/set-state-in-effect` disable at
`sdks/typescript/react/src/primitives/ActivationFlow.tsx:163`.

Confirmed unused — the rule does not flag the `setStep('activated')` on line 164 because it
is ref-guarded by `calledSuccessRef`. Delete line 163 only; the disables on lines 157, 174,
and 181 are still required.

---

## P2 — Vite/edge examples pulling in Node builtins

**Symptom:** `supabase-edge-mcp`, `cloudflare-workers-mcp`, and `mcp-checkout-app` externalize
`node:fs/promises`, `node:module`, `node:path`, `node:url` via `@solvapay/mcp-core` /
`@solvapay/server`.

Two independent sources:

1. **`@solvapay/server`** — `src/index.ts:11` statically imports `./native`, which imports
   `node:module`. The package already ships an edge entry
   (`"worker" | "edge-light" | "deno": "./dist/edge.js"`), but all three examples alias
   `@solvapay/server` to `server/src/index.ts` for workspace-source dev
   ([examples/typescript/cloudflare-workers-mcp/vite.config.ts](examples/typescript/cloudflare-workers-mcp/vite.config.ts)
   line 54 and siblings). Repoint those aliases at `server/src/edge.ts`. Verified safe:
   `createSolvaPay` — the only `@solvapay/server` import in these examples — is exported
   from `edge.ts` line 46.

2. **`@solvapay/mcp`** — `src/defaultMcpAppHtml.ts` statically imports `node:fs/promises`,
   `node:module`, and `node:path`, and is reachable from the main entry
   (`src/index.ts:46`) and from `internal/buildMcpServer.ts:21`, which uses it as the
   default `readHtml`. `@solvapay/mcp-core` is already clean (its only Node import,
   `descriptors.ts:122`, is a lazy `await import`).

   Fix package-side so downstream integrators benefit, not just our examples: add
   `worker` / `edge-light` / `deno` conditions to `@solvapay/mcp`'s `"."` and `"./fetch"`
   exports, backed by an edge variant of `defaultMcpAppHtml` that **throws** a clear
   "pass `readHtml` or `htmlPath` explicitly on edge runtimes" error rather than returning
   a stub. Failing loudly is required here — silently serving empty HTML is precisely the
   masked-failure pattern the repo forbids.

   `defaultMcpAppHtmlPath()` is internal (not re-exported from `index.ts`; only
   `__tests__/widget.test.ts` uses it), so its signature can change freely if needed.

Also add `resolve.conditions: ['worker', 'browser', 'import']` to the three Vite configs so
the published `dist/edge.js` is selected when the source aliases are not in play.

---

## P2 — example app build warnings

### `nextjs-auth0` — build requires live Auth0 credentials

**Symptom:** `Auth0Client` missing `AUTH0_CLIENT_ID` / client secret during `next build`,
plus webpack "Critical dependency: the request of a dependency is an expression" from
`@auth0/nextjs-auth0`'s `dpopUtils.js`.

`lib/auth0.ts` constructs `new Auth0Client()` at module scope and validates env on
construction. `SiteHeader` calls `auth0.getSession()` from the layout tree, so `next build`
evaluates it during static generation.

- Add `export const dynamic = 'force-dynamic'` to `app/layout.tsx` — this is the real fix;
  auth-dependent output must never be prerendered.
- Bootstrap env in the build script the way `hosted-checkout-demo` does:
  `"build": "[ -e '.env.local' ] || cp .env.example .env.local && next build --webpack"`,
  and give `.env.example` non-empty placeholder values (it currently has empty `AUTH0_CLIENT_ID=`
  / `AUTH0_CLIENT_SECRET=`). The client only requires presence at construction.
- Suppress the third-party webpack warning via `config.ignoreWarnings` in
  `next.config.mjs`, scoped to `/@auth0\/nextjs-auth0/`. It originates from a dynamic
  `require` inside the dependency and is not actionable here.

### `hosted-checkout-demo` — `MODULE_TYPELESS_PACKAGE_JSON`

**Symptom:** Node warns on `tailwind.config.ts` because the example's `package.json` lacks
`"type": "module"`. Every sibling example sets it.

Adding it alone **breaks** `postcss.config.js`, which is CommonJS (`module.exports`).
Convert that file to `postcss.config.mjs` with `export default { … }` — matching
`checkout-demo` and `nextjs-auth0` — and add `"type": "module"` in the same change.
`next.config.mjs` is already ESM, so nothing else is affected.

### `chat-checkout-demo` — 618 kB chunk

**Symptom:** Vite chunk > 500 kB. No `manualChunks`, no `chunkSizeWarningLimit`.

Split rather than raise the threshold: add
`build.rollupOptions.output.manualChunks` isolating `@google/genai`, `react-markdown`, and
`@stripe/*`. First confirm `@google/genai` is not being pulled into the client graph at all
— if it is only needed by `src/server/chat.ts`, a dynamic `import()` there removes the bulk
of the weight outright.

### `checkout-demo` — edge runtime disables static generation

**Symptom:** informational Next warning. Source is
`app/api/diag/impl-edge/route.ts`, which sets `runtime = 'edge'` deliberately to prove the
WASM core loads under workerd.

Working as intended. No code change — add a one-line comment recording that the warning is
expected for this diagnostic route.

---

## Non-issues — confirm and document only

### `pnpm test:live`

**Symptom:** `SOLVAPAY_LIVE_BASE_URL and SOLVAPAY_LIVE_API_KEY are required.`

Correct fail-fast behavior, already covered by a unit test in
[tools/conformance/live-all.test.ts](tools/conformance/live-all.test.ts). `test:live` is
opt-in: it is absent from `pnpm test`, `pnpm gates`, `.husky/pre-push`, and all of CI (the
live-contract workflows are `workflow_dispatch` only). It needs the platform stack on
`http://localhost:3010` and an `sk_sandbox_*` key, per
[docs/contributing/testing.md](docs/contributing/testing.md). **No change.**

### Go WASI guest — `wasm-opt not found`

**Symptom:** `wasm-opt not found; committing the cargo artifact verbatim`.

Intentional. [sdks/go/scripts/build-wasm.sh](sdks/go/scripts/build-wasm.sh) lines 39-45
degrade to an unoptimized copy on purpose, and CI deliberately omits Binaryen to avoid
cross-host blob drift. Note in contributing docs that `brew install binaryen` yields a
smaller local artifact. **No script change** — and do not add Binaryen to the Go CI job.

### npm 12.0.2 available

Unrelated to the repo; local toolchain notice. Ignore.

---

## Todos

Ordered. Each group is independently committable except `pnpm-migrate`, which must land
atomically. `ci-typecheck-gate` must be last so it does not land red.

### 1. Working-tree cleanup — do first, so later verification runs against a clean tree

- [x] `wt-revert-native` — revert host-target output over the canonical WASI artifacts:
      `sdks/node-native/{index.d.ts,index.js,server-native.wasi-browser.js,server-native.wasi.cjs}`
- [x] `wt-revert-wasm` — revert `sdks/wasm/pkg/` and `sdks/go/solvapay_core.wasm`
      (non-deterministic macOS rebuild drift; canonical bytes come from linux/amd64)
- [x] `wt-widget-recheck` — revert the six `mcp-app.html` copies, re-run
      `pnpm generated:external --rebuild --id mcpAppWidget`; commit only if the diff
      reproduces from committed sources
- [x] `wt-commit-next-env` — commit the five `next-env.d.ts` route-type path changes
- [x] `wt-document-trap` — record in [docs/contributing/testing.md](docs/contributing/testing.md)
      that `build:native`/`test:native` dirty tracked WASI artifacts and the tree must be
      restored before pushing

### 2. pnpm 9.6.0 -> 11.x migration — one atomic commit

- [x] `pnpm-workspace-settings` — add `overrides`, `linkWorkspacePackages: true`, and
      `allowBuilds` (pnpm 11 replacement for `onlyBuiltDependencies`) to
      [pnpm-workspace.yaml](pnpm-workspace.yaml)
- [x] `pnpm-remove-old-decls` — delete the `pnpm` block from [package.json](package.json),
      bump `packageManager` to `pnpm@11.15.0`, drop `link-workspace-packages` from `.npmrc`
- [x] `pnpm-ci-unpin` — remove the `version: 9.6.0` input at all 13 `pnpm/action-setup`
      sites across `ci.yml` (10), `publish.yml`, `publish-preview.yml`
- [x] `pnpm-relock` — `rm -rf node_modules && pnpm install`; confirm `next` still resolves
      to `16.2.7` and that pnpm reports **no** skipped dependency builds
- [x] `pnpm-drop-npx` — `npx` -> `pnpm exec` in
      [generate-types.ts](sdks/typescript/server/scripts/generate-types.ts) line 17 and
      `ci.yml` line 111; verify `openapi-typescript` is a declared devDependency first.
      Leave the `nodeNativeNapi` generator's `npx napi` alone.

### 3. Ruby native pipeline

- [x] `ruby-bundle-tasks` — add a `ruby.bundle` (`bundle install`) task in
      [tools/shared/surfaces.ts](tools/shared/surfaces.ts), sequenced before `ruby.build`,
      `ruby.prepare`, and `ruby-mcp.compile`
- [x] `ruby-recompile` — `cd sdks/ruby && bundle install && bundle exec rake compile`;
      assert `SolvaPay::REVERSE_CHARGE_NOTE` loads
- [x] `ruby-skew-assert` — extend `_check_version_skew` in `sdks/ruby/lib/solvapay.rb` to
      verify `SYNC_METHODS` is a subset of `SolvaPay::Native.singleton_methods`, naming the
      stale binary and the `rake compile` remedy
- [x] `ruby-pipeline-test` — assert in
      [tools/repo/test-all.test.ts](tools/repo/test-all.test.ts) that `bundle install`
      precedes every `rake compile`

### 4. React type drift

- [x] `react-balance-mocks` — route `McpTopupView.test.tsx:112` and
      `TopupForm.return.test.tsx:53` through the existing
      [mockBalanceStatus](sdks/typescript/react/src/test-helpers/mockBalanceStatus.ts);
      delete the local `mockBalance()`
- [x] `react-paywall-helper` — add `src/test-helpers/mockPaywallContent.ts` with the
      distributive `ShortMessageOptional` input type
- [x] `react-paywall-callsites` — replace 18 inline literals across
      `usePaywallResolver.test.tsx` (6) and `PaywallNotice.test.tsx` (12)
- [x] `react-remove-casts` — drop the `as PaywallStructuredContent` escapes in
      `checkout/index.test.tsx:823` and server `paywall-state.unit.test.ts:19`

### 5. Package-level warnings

- [x] `mcp-tsup-shims` — add `shims: true` to
      [sdks/typescript/mcp/tsup.config.ts](sdks/typescript/mcp/tsup.config.ts)
- [x] `turbo-cache-false` — add `@solvapay/server-native#build` and
      `@solvapay/server-wasm#build` overrides with `"cache": false` in
      [turbo.json](turbo.json). Do not invent `outputs` globs.
- [x] `react-eslint-line` — delete the unused disable at `ActivationFlow.tsx:163` only

### 6. Edge/Vite Node-builtin externalization

- [x] `mcp-edge-conditions` — add `worker`/`edge-light`/`deno` export conditions to
      `@solvapay/mcp` `"."` and `"./fetch"`, backed by an edge `defaultMcpAppHtml` that
      throws a clear "pass `readHtml` or `htmlPath`" error
- [x] `examples-server-edge-alias` — repoint the `@solvapay/server` alias at
      `server/src/edge.ts` and add `resolve.conditions` in the three Vite configs
      (`supabase-edge-mcp`, `cloudflare-workers-mcp`, `mcp-checkout-app`)

### 7. Example apps

- [x] `auth0-dynamic` — `export const dynamic = 'force-dynamic'` in
      `nextjs-auth0/app/layout.tsx`, env bootstrap in the build script, non-empty
      `.env.example` placeholders, scoped `ignoreWarnings` for `dpopUtils.js`
- [x] `hosted-esm` — add `"type": "module"` and convert `postcss.config.js` to
      `postcss.config.mjs` in the same change
- [x] `chat-chunks` — check whether `@google/genai` reaches the client graph; dynamic-import
      it server-side if so, then add `manualChunks` for the remaining vendors
- [x] `checkout-edge-comment` — one-line comment in
      `checkout-demo/app/api/diag/impl-edge/route.ts` noting the warning is expected

### 8. Docs-only

- [x] `docs-test-live` — note in
      [docs/contributing/testing.md](docs/contributing/testing.md) that `test:live` is
      opt-in and its fail-fast message is correct
- [x] `docs-binaryen` — note that `brew install binaryen` shrinks the local Go WASI
      artifact, and that CI intentionally omits it

### 9. Close the gate gap — last

- [x] `ci-typecheck-gate` — add root `pnpm typecheck` to CI, once every item above is green

## Verification

```bash
pnpm install --frozen-lockfile
pnpm typecheck                      # expect 0; was exit 2
pnpm gates                          # expect no hash warnings on a clean tree
pnpm build:native && pnpm test:native
git status --short                  # expect only intended changes
pnpm test
pnpm build:examples
```

After `build:native`/`test:native`, re-check `git status` and restore the WASI artifacts
before committing.

Ran: frozen install, `pnpm typecheck` (exit 0), MCP package build, targeted Ruby /
React / server / surface tests. Not run: `pnpm gates`, `pnpm test`, `build:native` /
`test:native`, `pnpm build:examples`. Changes are in the working tree; no git commit.
