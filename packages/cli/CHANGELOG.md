# solvapay

## 1.5.0

### Minor Changes

- 55885b2: `solvapay connect <merchant> --client claude --add-mcp` adds the merchant's MCP server to Claude Code at user scope once the owner approves, paying with the agent key. Claude Code reads the key through a `headersHelper` on each connection, so it never goes into Claude's config. On a merchant already connected, `--add-mcp` adds the server without asking the owner again.
- b3feb5d: `solvapay launch <claude|hermes> <merchant>` starts Claude Code or Hermes on a merchant that takes SolvaPay agent payments, paying with an agent key its owner approved on their phone or in a browser; `solvapay connect <merchant> --client <claude|hermes>` (its launch name or `prov_…` reference) is the same connection made by an agent itself, as one command run again until it says connected (it replaces `connect start` and `connect finish`). Both moved here from the `@solvapay/agents` package, whose `solvapay-agents` bin now points at them. Payments run in sandbox with test money while live agent payments aren't open.
- a611caa: The CLI handles Python and Go projects.
  - `solvapay init` detects the project's language (`go.mod`, `uv.lock`, `poetry.lock`, `pyproject.toml`, `requirements.txt`, `package.json`) before it touches anything, and installs the SDK exactly pinned with uv, Poetry or `go get`; for pip it prints the command. It no longer creates a `package.json` in a folder without one unless `--language ts` is passed: with no terminal, or `--yes`, a folder with no project files or files for two languages fails and names `--language`. New flags: `--language ts|python|go` and `--features mcp,agents,web` (`agents` is agent payments, a preview). Which SDK release it installs follows the CLI's own build: the stable CLI pins the newest stable release (and fails, naming the preview CLI, when a language has none), the preview CLI pins the newest preview.
  - `solvapay doctor` checks the SDK version in every language the project uses (npm, PyPI, the Go module proxy) and prints the exact upgrade command. A project with no SolvaPay SDK in any language now fails instead of passing with "nothing to check".
  - New `solvapay verify <server url>`: the TypeScript template's contract checks, for a running MCP server in any language.
  - `create-solvapay --type mcp --language python|go` scaffolds a from-scratch paid MCP server with one paid and one free tool, tests, `.env.example`, a Dockerfile and Dependabot. A preview build of create-solvapay pins the newest SDK previews (for TypeScript too, from npm's `preview` tag); a stable build pins stable releases.

### Patch Changes

- ec5b929: `solvapay connect` tells the owner that payments run in sandbox with test money and nothing real is charged while live payments aren't open. When SolvaPay refuses because the merchant doesn't take agent payments yet, or because live agent payments aren't open yet, `launch` and `connect` say so in a plain sentence instead of printing the raw 403. The README now shows the arguments the CLI takes: `--client <claude|hermes>` and the merchant's launch name or `prov_…` reference.
- ac65287: `solvapay connect` prints next steps an agent can run as they are: the command to run again names the preview CLI (`npx solvapay@preview`) when that is what is running, and quotes values such as a `--name` with spaces. Once connected with `--client claude`, it offers `launch` only when the merchant has a model API; for an MCP-only merchant it says to run the same command with `--add-mcp`.
- ec77a0e: `solvapay` and `create-solvapay` depend on the exact `@solvapay/init` version they were released with. With a caret range, a preview build (`…-preview-<commit sha>`) resolved `@solvapay/init` to the preview whose commit sha sorts last alphabetically, not its own, and failed to start when that build lacked an export it uses.
- 469aa57: `solvapay doctor` now checks that the project's installed `@solvapay/*` packages match npm: `latest`, or `preview` for a preview build. When any is behind, the check fails and prints the exact upgrade command for the project's package manager. A declared package that isn't installed, or a registry lookup that fails, also fails the check. `@solvapay/init` exports the check (`findOutdatedSolvapayPackages`, `solvapayDependencies`, `upgradeCommand`, `compareStable`).
- Updated dependencies [a611caa]
- Updated dependencies [469aa57]
  - @solvapay/init@0.6.0

## 1.4.0

### Minor Changes

- a90cfea: Node.js 22 or later is now required (`engines.node` is `>=22`). Node 18 and 20 are end-of-life and get no security fixes, including the 2026-10-21 Node.js security release. The SDK is now tested on Node 22, 24 and 26. On Node 22 the bundled npm 10 installs the MCP template, so the earlier advice to upgrade npm on Node 20 no longer applies.

### Patch Changes

- Updated dependencies [a90cfea]
  - @solvapay/init@0.5.0

## 1.3.1

### Patch Changes

- 4f5a484: `solvapay init` warns when it writes a live secret key, and a non-interactive re-run refuses to overwrite an existing key unless `--yes` is passed. Non-interactive runs without `--product` say that deploy fails until the product placeholder is replaced.
- Updated dependencies [4f5a484]
  - @solvapay/init@0.4.6

## 1.3.0

### Minor Changes

- 3a310eb: Add tiered product config validation: sync `productRef` shape checks + one-line MCP config logging, enriched OAuth DCR failure diagnostics, opt-in `verifyProductConfiguration()` on `@solvapay/server`, and `solvapay doctor` for explicit network checks (secret key, product existence, readiness).

### Patch Changes

- Updated dependencies [3a310eb]
  - @solvapay/init@0.4.0

## 1.2.0

### Minor Changes

- 254498f: Surface the `init --product` flag in the CLI so the product can be selected non-interactively during `solvapay init`.

### Patch Changes

- Updated dependencies [254498f]
  - @solvapay/init@0.3.0

## 1.1.0

### Minor Changes

- 5f04b1c: Add `create-solvapay` umbrella scaffolder and `@solvapay/init`
  shared lib.

  `npm create solvapay <name> -- --type mcp` scaffolds a SolvaPay-monetized
  Cloudflare Workers MCP server in one pass. v1 ships one project type
  (`mcp`) with two sub-modes:
  - `from-openapi` — generate one MCP tool per spec operation, with
    one-to-one tier defaults from `suggestedTier`.
  - `from-scratch` — drop in a single placeholder paid tool (camelCase
    name, default `helloTool`) so the project deploys without writing any
    code first.

  The umbrella shape leaves `--type cli`, `--type api`, etc. as additive
  follow-ups that do not require a new npm package.

  `@solvapay/init` is the shared lib both `solvapay` and
  `create-solvapay` depend on (browser auth, env writers, product picker,
  install runner, `runInitInDirectory`). The `solvapay init` CLI's
  externally observable behaviour is byte-identical to 1.0.x; the minor
  bump on `solvapay` reflects the new transitive `@solvapay/init`
  dependency.

  Intent-driven tool clustering is intentionally only available via the
  `solvapay/create-mcp-app` skill (Cursor / Claude Code) — it needs an LLM
  agent to author the resulting `src/tools/*.ts` files.

- df968c1: Interactive product picker and product-ref validation in `solvapay init`.

  `npx solvapay init` now configures `SOLVAPAY_PRODUCT_REF` end-to-end. After the secret key is verified:
  - If `.env` already has a real product ref, the picker verifies it against `GET /v1/sdk/products/<ref>` and asks whether to keep it.
  - Otherwise it lists products on the account (newest first, up to 10) and prompts the user to pick one. A single product confirms with `[Y/n]`; multiple products show a numbered list with default `1`.
  - `--yes` (or non-interactive stdin) auto-picks the newest product.
  - Zero products warns and points to SolvaPay Console → Products; init still completes.

  Scaffold placeholders (`__SOLVAPAY_PRODUCT_REF__`) and missing values both trigger the picker automatically, so wrong / fake refs fail fast at init time instead of surfacing as cryptic OAuth or upstream errors later. New `product-picker.ts` + `products.ts` modules under `packages/cli/src/lib/` with full unit-test coverage.

### Patch Changes

- 84f8598: Env-aware merchant verify in `solvapay init` + new `--skip-install` /
  `--skip-init` flags on `npm create solvapay`.

  `solvapay init` now hard-fails on merchant lookup **before** writing
  `.env`, adding `.env` to `.gitignore`, or installing the SDK — so a
  failing probe no longer leaves a half-scaffolded project behind. The
  existing "secret key verified" line is also relabelled to "secret key
  authenticates" so it stops printing right before a `not_found`.

  `@solvapay/init` parses the backend's new structured 4xx bodies:
  - `404 provider_not_found_in_environment` → `VerifyMerchantResult` now
    carries `environment` and `providerExistsInSandbox`. When the user's
    sandbox account exists but live isn't promoted, the CLI now points
    them at "switch to live in the Console" instead of generic
    onboarding.
  - `403 key_env_mismatch` → new `env_mismatch` discriminant on
    `VerifyMerchantResult`, surfaced as a dedicated error with both the
    key env and the provider env. Previously this would have fallen
    through to a generic `error`.

  The `not_found` message now also names the environment (falling back to
  the env returned by the cli-init exchange when the backend body omits
  it), so the recovery path is unambiguous.

  `create-solvapay` adds two new flags for re-runnable / scripted
  scaffolds:
  - `--skip-install` — skip the post-scaffold `npm install`. The "next
    steps" footer reminds the user to install manually.
  - `--skip-init` — skip the post-scaffold `solvapay init` step (no
    browser OAuth). The footer adds `npx solvapay init` to the next
    steps so the user wires up auth + product when they're ready.

- Updated dependencies [5f04b1c]
- Updated dependencies [84f8598]
  - @solvapay/init@0.2.0

## 1.0.9

### Patch Changes

- 8dd8638: Bump runtime `inquirer` dependency from `^13.3.2` to `^13.4.2` (patch). No behaviour change — picks up upstream bug fixes.
- Updated dependencies [8dd8638]
  - @solvapay/server@1.0.12

## 1.0.8

### Patch Changes

- 4b3de6a: Resync stable manifests so dependents pin to stable `@solvapay/core` and `@solvapay/auth` instead of the leftover `1.0.8-preview.10` references that the previous release accidentally baked into `@solvapay/server@1.0.9`, `@solvapay/next@1.0.8`, `@solvapay/mcp-core@0.2.1`, and `@solvapay/mcp@0.2.1`.

  The root cause was that `core`, `auth`, `solvapay` (CLI), and `react-supabase` had pre-release `1.0.8-preview.X` strings sitting in their `package.json` `version` fields on `main` (leftovers from the pre-changesets preview workflow that the migration commit never reset). Because no changeset had touched those four since the migration, changesets-action never bumped them, and `pnpm publish` substituted every `workspace:*` reference in the recently-released siblings with that literal preview string.

  This changeset:
  - Resets `core`, `auth`, `solvapay`, and `react-supabase` to the last actually-published stable (`1.0.7`) so the patch bumps below land on `1.0.8`.
  - Forces a patch bump on `server`, `next`, `mcp-core`, and `mcp` so they re-publish with their workspace dep references substituted from the now-stable `1.0.8` siblings.

  The publish workflow has also been hardened to reject any workspace package that carries a pre-release version identifier on `main` before invoking `changesets/action`, and `scripts/verify-npm-publishes.mjs` now checks each freshly-published manifest for `dependencies` / `peerDependencies` values that resolve to pre-release identifiers — both of which would have caught this regression.

- Updated dependencies [4b3de6a]
  - @solvapay/core@1.0.8
  - @solvapay/auth@1.0.8
  - @solvapay/server@1.0.10
