# @solvapay/init

## 0.6.0

### Minor Changes

- a611caa: The CLI handles Python and Go projects.
  - `solvapay init` detects the project's language (`go.mod`, `uv.lock`, `poetry.lock`, `pyproject.toml`, `requirements.txt`, `package.json`) before it touches anything, and installs the SDK exactly pinned with uv, Poetry or `go get`; for pip it prints the command. It no longer creates a `package.json` in a folder without one unless `--language ts` is passed: with no terminal, or `--yes`, a folder with no project files or files for two languages fails and names `--language`. New flags: `--language ts|python|go` and `--features mcp,agents,web` (`agents` is agent payments, a preview). Which SDK release it installs follows the CLI's own build: the stable CLI pins the newest stable release (and fails, naming the preview CLI, when a language has none), the preview CLI pins the newest preview.
  - `solvapay doctor` checks the SDK version in every language the project uses (npm, PyPI, the Go module proxy) and prints the exact upgrade command. A project with no SolvaPay SDK in any language now fails instead of passing with "nothing to check".
  - New `solvapay verify <server url>`: the TypeScript template's contract checks, for a running MCP server in any language.
  - `create-solvapay --type mcp --language python|go` scaffolds a from-scratch paid MCP server with one paid and one free tool, tests, `.env.example`, a Dockerfile and Dependabot. A preview build of create-solvapay pins the newest SDK previews (for TypeScript too, from npm's `preview` tag); a stable build pins stable releases.

- 469aa57: `solvapay doctor` now checks that the project's installed `@solvapay/*` packages match npm: `latest`, or `preview` for a preview build. When any is behind, the check fails and prints the exact upgrade command for the project's package manager. A declared package that isn't installed, or a registry lookup that fails, also fails the check. `@solvapay/init` exports the check (`findOutdatedSolvapayPackages`, `solvapayDependencies`, `upgradeCommand`, `compareStable`).

### Patch Changes

- Updated dependencies [80b8b65]
  - @solvapay/core@1.9.0

## 0.5.0

### Minor Changes

- a90cfea: Node.js 22 or later is now required (`engines.node` is `>=22`). Node 18 and 20 are end-of-life and get no security fixes, including the 2026-10-21 Node.js security release. The SDK is now tested on Node 22, 24 and 26. On Node 22 the bundled npm 10 installs the MCP template, so the earlier advice to upgrade npm on Node 20 no longer applies.

## 0.4.7

### Patch Changes

- Updated dependencies [b3edfd8]
  - @solvapay/core@1.8.0

## 0.4.6

### Patch Changes

- 4f5a484: `solvapay init` warns when it writes a live secret key, and a non-interactive re-run refuses to overwrite an existing key unless `--yes` is passed. Non-interactive runs without `--product` say that deploy fails until the product placeholder is replaced.

## 0.4.5

### Patch Changes

- Updated dependencies [d15f9ca]
  - @solvapay/core@1.7.1

## 0.4.4

### Patch Changes

- Updated dependencies [f994f1a]
  - @solvapay/core@1.7.0

## 0.4.3

### Patch Changes

- Updated dependencies [a98faa9]
  - @solvapay/core@1.6.0

## 0.4.2

### Patch Changes

- Updated dependencies [a47adff]
  - @solvapay/core@1.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [e936ac0]
  - @solvapay/core@1.4.0

## 0.4.0

### Minor Changes

- 3a310eb: Add tiered product config validation: sync `productRef` shape checks + one-line MCP config logging, enriched OAuth DCR failure diagnostics, opt-in `verifyProductConfiguration()` on `@solvapay/server`, and `solvapay doctor` for explicit network checks (secret key, product existence, readiness).

### Patch Changes

- Updated dependencies [800f081]
- Updated dependencies [3a310eb]
  - @solvapay/core@1.3.0

## 0.3.0

### Minor Changes

- 254498f: Add `init --product` so a product ref can be verified without the interactive picker, failing closed in non-interactive runs when `--product` is omitted.

## 0.2.0

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
