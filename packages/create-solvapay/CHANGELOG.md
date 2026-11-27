# create-solvapay

## 0.9.3

### Patch Changes

- 2743466: New MCP projects start on the SDK released with it: `@solvapay/server` 2.13.0.

## 0.9.2

### Patch Changes

- 8ce91ba: New MCP projects start on the SDK released with it: `@solvapay/mcp` 0.5.2, `@solvapay/mcp-core` 0.6.1 and `@solvapay/server` 2.12.1.

## 0.9.1

### Patch Changes

- 1971bee: A failed `npm install` now stops the scaffold with an error and a non-zero exit, as `uv sync` and `go mod tidy` already did for Python and Go. TypeScript MCP and next-auth0 projects used to print a warning, skip nothing, and finish with exit 0, leaving a project with no `node_modules` that looked complete.
- 0981bf1: New MCP projects start on the SDK released with it: `@solvapay/mcp` 0.5.1, `@solvapay/mcp-core` 0.6.0, `@solvapay/server` 2.12.0 and `@solvapay/react` 2.7.2.
- 5040df6: `solvapay init` no longer breaks a Python MCP server that runs on `mcp` 1.x.
  - With `--features mcp`, init reads `uv.lock`, `poetry.lock`, `pyproject.toml`, `requirements.txt` and the project's `.py` files before the browser opens. It stops, with nothing written, when `mcp` is locked below 2, a requirement rules out `mcp` 2.3, the project uses `fastapi-mcp`, or code imports `mcp.server.fastmcp` or `fastapi_mcp`. Installing `solvapay[mcp]` there used to upgrade `mcp` to 2.x and leave a server that couldn't start. The message names each cause and links the `mcp` 2.x migration guide and the SolvaPay MCP guide. A project on fastmcp gets a warning that SolvaPay has no fastmcp adapter.
  - init saves the product to `.env` before installing the SDK, so a failed install leaves a complete `.env`.
  - With `--features mcp` in Python and Go, init adds `PORT` and `PUBLIC_BASE_URL` to `.env` when they're missing (`8080`, as the scaffolds do), links the language's MCP guide in its next steps and prints `npx -y solvapay@latest` (or `@preview`) commands.
  - `solvapay doctor` scans a Python project's `.py` files. An import of `mcp.server.fastmcp` or `fastapi_mcp` fails the run once the project is on `mcp` 2.x and only warns while it is still on 1.x. The `SOLVAPAY_DEBUG` warning now shows only for TypeScript projects.
  - Without a terminal (an AI agent, CI, `--yes`), init lists the account's products with their refs and prints the exact `npx -y solvapay@latest init --product <prd_...>` command, instead of only saying it skipped the choice.
  - An empty value in `.env` (`SOLVAPAY_PRODUCT_REF=`) is read as unset. Before, init and doctor read the next line as its value, and replacing a key also removed the blank lines above it.

- c5f8d2d: The Python and Go MCP servers are stateless by default, as the TypeScript server is.
  - Python `http_app()` and Go `Handler()` issue no `mcp-session-id`, and a request needs no earlier `initialize` on the same instance. In-memory sessions broke once a load balancer spread one client over several instances, and clients that send one request per call got `400 Missing session ID` (Python) or `method "tools/list" is invalid during session initialization` (Go). For sessions, pass `http_app(stateless_http=False)` in Python or set `MCPServerOptions.Stateful` in Go, on a single instance or with sticky routing.
  - The Python and Go scaffolds from `create-solvapay` pass `hide_tools_by_audience=["ui"]` / `HideToolsByAudience: []string{"ui"}`, as the TypeScript template does, so the widget's own tools stay out of `tools/list` and `solvapay verify` passes on a fresh scaffold. The MCP guides' first example does the same.

- Updated dependencies [5040df6]
  - @solvapay/init@0.6.1

## 0.9.0

### Minor Changes

- a611caa: The CLI handles Python and Go projects.
  - `solvapay init` detects the project's language (`go.mod`, `uv.lock`, `poetry.lock`, `pyproject.toml`, `requirements.txt`, `package.json`) before it touches anything, and installs the SDK exactly pinned with uv, Poetry or `go get`; for pip it prints the command. It no longer creates a `package.json` in a folder without one unless `--language ts` is passed: with no terminal, or `--yes`, a folder with no project files or files for two languages fails and names `--language`. New flags: `--language ts|python|go` and `--features mcp,agents,web` (`agents` is agent payments, a preview). Which SDK release it installs follows the CLI's own build: the stable CLI pins the newest stable release (and fails, naming the preview CLI, when a language has none), the preview CLI pins the newest preview.
  - `solvapay doctor` checks the SDK version in every language the project uses (npm, PyPI, the Go module proxy) and prints the exact upgrade command. A project with no SolvaPay SDK in any language now fails instead of passing with "nothing to check".
  - New `solvapay verify <server url>`: the TypeScript template's contract checks, for a running MCP server in any language.
  - `create-solvapay --type mcp --language python|go` scaffolds a from-scratch paid MCP server with one paid and one free tool, tests, `.env.example`, a Dockerfile and Dependabot. A preview build of create-solvapay pins the newest SDK previews (for TypeScript too, from npm's `preview` tag); a stable build pins stable releases.

- 6f8eb1e: Scaffolds no longer start, or stay, behind the SDK.
  - If the npm registry lookup for `@solvapay/*` fails, the scaffold stops with an error naming each package and why, instead of quietly pinning old fallback versions. Pass `--offline` to pin the versions this release ships with on purpose.
  - The template's `@solvapay/*` pins are exact and current (`@solvapay/mcp` 0.5.0, `@solvapay/mcp-core` 0.5.0, `@solvapay/server` 2.11.0, `@solvapay/react` 2.7.1). `pnpm --filter create-solvapay sync:sdk-pins` keeps them on npm's `latest` after each release.
  - A generated project's `npm run deploy` stops when an installed `@solvapay/*` package is behind npm and prints the exact upgrade command. `--allow-outdated` deploys those versions on purpose.
  - Generated projects ship `.github/dependabot.yml`, which opens one weekly pull request moving all `@solvapay/*` packages to npm's latest together.

- 82369d2: `--tool-name` takes snake_case for TypeScript MCP servers, the MCP naming convention, and defaults to `hello_tool`. The name is used as-is for the file and the registered tool, and the generated function is `register<PascalCase>` (`generate_haiku` → `registerGenerateHaiku`), so no rename is needed after scaffolding. camelCase is still accepted.

### Patch Changes

- ec77a0e: `solvapay` and `create-solvapay` depend on the exact `@solvapay/init` version they were released with. With a caret range, a preview build (`…-preview-<commit sha>`) resolved `@solvapay/init` to the preview whose commit sha sorts last alphabetically, not its own, and failed to start when that build lacked an export it uses.
- Updated dependencies [a611caa]
- Updated dependencies [469aa57]
  - @solvapay/init@0.6.0

## 0.8.2

### Patch Changes

- 9e79637: Generated MCP tools send `in: header` parameters as request headers. Header params named `Accept`, `Content-Type`, `Authorization` or the upstream API key header are left out of the tool input, so the LLM can't supply or overwrite the credential. Parameters whose names aren't valid JavaScript identifiers (e.g. `page-size`, `X-Request-Id`) no longer generate invalid `input.["…"]` code.

## 0.8.1

### Patch Changes

- 8c831f7: Generated MCP servers keep 64-bit integer IDs exact. `upstreamFetchJson` returns integers beyond `Number.MAX_SAFE_INTEGER` as exact decimal strings instead of rounding them, `int64` params get a schema that accepts a safe number or a digit string, and request bodies with integer properties are sent with the new `stringifyLossless` helper so those strings go back upstream as exact numbers.
- 66e8a0f: Swagger 2.0 specs generate working tools. Parameters are typed from their own `type` / `format` instead of all becoming strings, `in: body` parameters are sent upstream as the JSON request body, and tools with a body always send `content-type: application/json`, including when the upstream needs no auth.
- fd4b825: Swagger 2.0 form operations generate working tools: `in: formData` fields are sent URL-encoded (or as multipart when the operation only accepts multipart), and `type: file` fields are left out of the tool input, with `describe.mjs` suggesting `skip` for those operations. Array request bodies are typed as arrays. `describe.mjs` and the project's `test.mjs` now put sample request bodies under `body`, matching the generated tool input.

## 0.8.0

### Minor Changes

- a90cfea: Node.js 22 or later is now required (`engines.node` is `>=22`). Node 18 and 20 are end-of-life and get no security fixes, including the 2026-10-21 Node.js security release. The SDK is now tested on Node 22, 24 and 26. On Node 22 the bundled npm 10 installs the MCP template, so the earlier advice to upgrade npm on Node 20 no longer applies.

### Patch Changes

- Updated dependencies [a90cfea]
  - @solvapay/init@0.5.0

## 0.7.3

### Patch Changes

- 4f5a484: OpenAPI 3.1 patch versions parse during describe and scaffold, and the generated Worker deploy script uses the Wrangler config for the account you logged into. A first deploy uploads secrets after the Worker exists, and auth is checked before the widget build.
- Updated dependencies [4f5a484]
  - @solvapay/init@0.4.6

## 0.7.2

### Patch Changes

- c068fb5: The next-auth0 starter now finds its template from the published package. `--openapi` accepts http(s) URLs and relative local paths, and non-spec URLs fail with a clear error instead of a filesystem ENOENT.

## 0.7.1

### Patch Changes

- 87ddb16: Fix the MCP scaffold so generated projects advertise `/mcp`, install `@solvapay/mcp-core`, and resolve offline fallbacks against current npm latest. Exact `@solvapay/*` pins stay exact — the failure that prompted this started when a caret floated onto a peer-widening patch.

## 0.7.0

### Minor Changes

- af077fe: Add `registerFree` for otherwise-free MCP tools with a per-customer cap declared in code. Tools that name the same `free-*` meter share one allowance; exhaustion emits the existing paywall gate (`paywallReason: 'limit_reached'`). Unidentified callers fail with `identity_required` instead of sharing an anonymous bucket. The scaffolder accepts a `free-capped` operation tier that emits `ctx.registerFree`.

## 0.6.1

### Patch Changes

- f994f1a: Unify MCP commerce surfaces and ship the v3 account widget (states A–J).

  **Layout and chrome.** One layout law across checkout, top-up, and account: primary content leads, seller and your-account trails, identity rail visible at every width. `<McpApp>` reads host `displayMode` and advertises `inline` + `fullscreen`. Inline chrome is a centered `36rem` block; fullscreen is a hosted 1000px column (340 payment / 300 management rails) that falls back to the stacked widget under 1000px host width. Drop the shell sidebar — identity moves to `McpPayingAs` inside the payment form. Blend the widget into the host canvas (transparent root, hairline card, `color-scheme` meta in scaffolder and examples).

  **Account widget.** StatusPill, FactBand, and UsageMeter (warning at 80%, critical at 100%) with v3 usage captions. Route each plan family through its own panel; ladder rows use per-row Activate/Switch (in-place when no payment, checkout when payment is required). Fullscreen extras: plan consequence lines, credit-activity and charges tables, merchant/buyer footer. Dedicated auto-recharge view from the account panel; shared fields in top-up. Seed bootstrap `limits` into `useLimits`/`useUsage`. `useHistory` fetches charges and credit activity on section mount.

  **Checkout and payment.** Theme Stripe Payment Element from `--solvapay-*` tokens; tabs layout by default. Own billing country in the widget (not PaymentElement). Move mandate text below the pay button. Remove decorative save-card checkbox on PAYG; pass deferred auto-recharge into top-up so the card is saved for off-session reuse. `planPricingShape` so usage-based $0 plans are not labelled Free and one-time vs monthly render correctly.

  **Links and polish.** Outbound links route through host `ui/open-link` when `openLinks` is declared (`useExternalLinkClick`, `useOpenExternal`, `<ExternalLinkProvider>`; `<McpApp>` mounts automatically). Drop fullscreen `CloseButton` export — host owns window chrome. Portal history links render as text; shell centres at 1144px. Seller-card email/support render as plain text (no iframe navigation).

  **Breaking (MCP-only exports).** Removed `McpSellerDetailsCard`, `McpCustomerDetailsCard`, `McpAccountView.hideDetailCards`, `McpLimitReached`, and `CloseButton`. Turnkey `<McpApp>` integrators are unaffected; custom shells that imported these must migrate.

  **Templates.** Example and `create-solvapay` pass `SOLVAPAY_MCP_APP_CAPABILITIES` into `new App()`.

- 5d37370: Make MCP gate and intent-tool results usable on text-only hosts. Default `mode` is `auto`, the paywall gate names included usage and a pasteable https checkout URL, and narrators emit plan refs so recovery no longer depends on an iframe.
  - @solvapay/init@0.4.4

## 0.6.0

### Minor Changes

- 12f446b: The `mcp` scaffold now generates an SDK v2 project: templates depend on `@modelcontextprotocol/core` and `@modelcontextprotocol/server` instead of `@modelcontextprotocol/sdk`, the generated worker builds its server through a per-request factory, and the pinned `@solvapay/mcp` runtime dependency moves to the `0.3.x` line.

### Patch Changes

- 1033383: Reject paid usage-based plans as the product default. Only free recurring or free usage-based plans can be auto-assigned; a per-unit charge now requires explicit customer activation.
- Updated dependencies [3a310eb]
  - @solvapay/init@0.4.0

## 0.5.0

### Minor Changes

- 2de7fd8: Add Auth0 identity adapters across `@solvapay/auth`, `@solvapay/react`, and `@solvapay/next` (`createAuth0AuthMiddleware`), plus a `next-auth0` scaffolder template. The Next.js middleware now strips client-supplied identity headers (`x-user-id`, `authorization`) before forwarding a verified session identity downstream.

## 0.4.0

### Minor Changes

- 254498f: Harden the OpenAPI-to-MCP scaffold: require explicit upstream base URLs when specs omit usable servers, share OpenAPI advisories across CLI and agent paths, and prevent non-interactive init from binding an unconfirmed product.

### Patch Changes

- Updated dependencies [254498f]
  - @solvapay/init@0.3.0

## 0.3.0

### Minor Changes

- 776e4d4: Add `apiKey-multi` upstream auth for OpenAPI specs that require two or more static credential headers together (multi-scheme AND, no token exchange). The scaffolder auto-detects supported header schemes, seeds a single `UPSTREAM_API_HEADERS` compact-JSON secret, and generated tools spread parsed headers on upstream calls.

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

### Patch Changes

- Updated dependencies [5f04b1c]
- Updated dependencies [84f8598]
  - @solvapay/init@0.2.0
