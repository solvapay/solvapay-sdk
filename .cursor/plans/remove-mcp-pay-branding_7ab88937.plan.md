---
name: remove-mcp-pay-branding
overview: Replace "MCP Pay" / "Hosted MCP Pay" branding across docs, skills, and cursor-plugin with descriptive technical naming ("No-code MCP integration" vs "SDK integration"). No new brand noun is introduced. Code-level surfaces (Console UI text, OpenAPI descriptions, SDK comments, website, `isMcpPay` field rename) are flagged for follow-up plans.
todos:
  - id: verify-openapi-source
    content: Verify whether docs/api-reference/openapi.json is hand-maintained or synced from solvapay-backend; if synced, defer OpenAPI text rewrite to a backend follow-up plan
    status: pending
  - id: skills-folder-rename
    content: Rename skills/solvapay/mcp-pay/ to skills/solvapay/no-code-mcp/ and rewrite guide.md per naming canon
    status: pending
  - id: skills-router-update
    content: Update skills/solvapay/SKILL.md and AGENTS.md (description, path index, guardrails, routing table, trigger phrases)
    status: pending
  - id: skills-cross-refs
    content: Update cross-references in sdk-integration/mcp-server/, sdk-integration/reference.md, building-mcp-app/, website-checkout/, provider-onboarding/
    status: pending
  - id: plugin-manifest-update
    content: Update plugins/solvapay/.cursor-plugin/plugin.json keywords (mcp-pay -> no-code-mcp); verify READMEs
    status: pending
  - id: plugin-vendor-skills
    content: Re-vendor skills content into plugins/solvapay/skills/solvapay/ (rsync from skills repo) and rename folder
    status: pending
  - id: docs-folder-rename
    content: Rename docs/mcp-pay/ to docs/no-code-mcp/, rename create-hosted-mcp-pay-product.mdx to create-no-code-mcp-product.mdx
    status: pending
  - id: docs-nav-redirects
    content: "Update docs.json: rename group to \"No-code MCP integration\", update 6 page paths, add /mcp-pay/* -> /no-code-mcp/* redirects"
    status: pending
  - id: docs-rewrite-six-pages
    content: Rewrite the 6 dedicated no-code-mcp/*.mdx pages per naming canon, add disambiguation one-liner to overviews
    status: pending
  - id: docs-passing-references
    content: Update in-passing references across index.mdx, get-started/, guides/, mcp-server/, sdks/typescript/setup/cli.mdx, webhooks.mdx
    status: pending
  - id: docs-openapi-text
    content: Rewrite OpenAPI human-readable descriptions in api-reference/openapi.json (only if hand-maintained, per first todo); keep isMcpPay field name with deprecation note pointing at isNoCodeMcp
    status: pending
  - id: docs-contributor-meta
    content: Update docs/AGENTS.md contributor terminology rule, README.md scope reference, and internal/docs-* notes
    status: pending
  - id: validation-pass
    content: Run mint broken-links, ripgrep verification across all three repos, validate plugin manifest, smoke-test plugin sync
    status: pending
isProject: false
---

# Remove "MCP Pay" branding from technical docs

## Naming canon (single source of truth)

Apply consistently in docs, skills, and cursor-plugin:

- **Section / nav label** for the no-code path: **"No-code MCP integration"** (parallel to the existing "SDK integration")
- **Mid-sentence shorthand**: **"the no-code path"** vs **"the SDK path"**
- **Action phrase used in body prose** (overview pages, decision pages, comparison sections): *"add SolvaPay to your MCP server"* -- describes the goal both paths achieve. Never used as a section label because it doesn't disambiguate which path is being discussed
- **Library artifact**: **"TypeScript SDK"** -- use only when referring to the package, install commands, API reference. Don't conflate with "SDK integration" (the path)
- **Mechanism word**: **"reverse proxy"** -- use only in the architecture / how-it-works page where engineers need the network model. Don't sprinkle it elsewhere
- **First-mention disambiguation one-liner** (insert near top of every overview/landing page on the no-code path): *"You keep ownership and hosting of your MCP server; SolvaPay sits in front of it as a reverse proxy and handles OAuth, paywall enforcement, and billing."*
- **No new brand noun**: do not introduce "Managed MCP", "MCP Gateway", "MCP Endpoint", or any other named replacement. The deliberate choice is to describe rather than to brand
- **Discovery / trigger phrases for skills + plugin**: `"no-code mcp"`, `"monetize mcp server"`, `"mcp without code"`, `"mcp paywall"`, `"hosted mcp monetization"`, `"managed mcp"`, `"mcp pay"` (yes -- include the old brand and rejected near-names as triggers; users will search for them)
- **Future field rename target** (NOT executed in this plan, just documented): `isMcpPay` -> `isNoCodeMcp`

## Out of scope (flagged for follow-up plans)

- `solvapay-frontend` Console UI: `ProductTypeBadge`, wizard copy, integration option cards (`'MCP Pay' / 'SDK'` badges and "Activate MCP Pay (no-code)" copy)
- `solvapay-backend` OpenAPI text: `@ApiProperty` descriptions in [`product.types.ts`](solvapay-backend/src/products/types/product.types.ts) and Swagger annotations in `product.sdk.controller.ts` / `product.ui.controller.ts`; runtime error string in [`mcp-bootstrap-core.lib.ts`](solvapay-backend/src/products/services/lib/mcp-bootstrap-core.lib.ts); MCP virtual-tool param description in [`virtual-tools.constants.ts`](solvapay-backend/src/mcp/lib/virtual-tools.constants.ts)
- `solvapay-sdk` code comments in [`packages/server/src/virtual-tools.ts`](solvapay-sdk/packages/server/src/virtual-tools.ts) and `examples/mcp-checkout-app`; generated JSDoc in `packages/server/src/types/generated.ts` (will follow OpenAPI rewrite)
- `solvapay-website` [`public/llms.txt`](solvapay-website/public/llms.txt), Sanity seed product in [`src/sanity/lib/seed-products.ts`](solvapay-website/src/sanity/lib/seed-products.ts), Studio field example text in `src/sanity/schemaTypes/documents/productPageType.ts`
- `isMcpPay` -> `isNoCodeMcp` field rename across backend Mongo schema, OpenAPI, SDK types, frontend types/queries (breaking change for integrators -- needs migration plan)

---

## Repo 1: `docs/`

### Folder + nav rename

- Rename folder `docs/mcp-pay/` -> `docs/no-code-mcp/`
- Rename file `mcp-pay/create-hosted-mcp-pay-product.mdx` -> `no-code-mcp/create-no-code-mcp-product.mdx` (other 5 filenames already neutral: `overview.mdx`, `quick-start.mdx`, `authentication.mdx`, `hosted-pages.mdx`, `best-practices.mdx`)
- Update [`docs.json`](docs/docs.json) lines 46-56: rename group from `"MCP Pay"` to `"No-code MCP integration"`, keep icon `credit-card`, update all 6 page paths
- Add redirects in [`docs.json`](docs/docs.json) `redirects` array (line 147) so old URLs (`/mcp-pay/overview`, etc.) 301 to new ones -- preserves external links and search rankings:

```json
{ "source": "/mcp-pay/:slug", "destination": "/no-code-mcp/:slug" },
{ "source": "/mcp-pay/create-hosted-mcp-pay-product", "destination": "/no-code-mcp/create-no-code-mcp-product" }
```

### Page rewrites (the 6 dedicated pages)

Rewrite all "MCP Pay" / "Hosted MCP Pay" mentions per the naming canon. Each overview-style page gets the disambiguation one-liner near the top.

- [`no-code-mcp/overview.mdx`](docs/no-code-mcp/overview.mdx) -- title (e.g. `"No-code MCP integration overview"`), frontmatter, "How MCP Pay works" heading -> "How it works", comparison table, links
- [`no-code-mcp/quick-start.mdx`](docs/no-code-mcp/quick-start.mdx) -- title (`"No-code MCP quick start"`), "Hosted MCP Pay flow" heading -> "Quick-start flow", body
- [`no-code-mcp/create-no-code-mcp-product.mdx`](docs/no-code-mcp/create-no-code-mcp-product.mdx) -- title (`"Create a no-code MCP product"`), step headings, body
- [`no-code-mcp/authentication.mdx`](docs/no-code-mcp/authentication.mdx) -- description + body (e.g. "MCP Pay supports Dynamic Client Registration" -> "The no-code MCP integration supports Dynamic Client Registration")
- [`no-code-mcp/hosted-pages.mdx`](docs/no-code-mcp/hosted-pages.mdx) -- description + body. Note: keep the term "hosted pages" (refers to checkout/portal UX hosted by SolvaPay, not the MCP server) -- this is *not* the same as "Hosted MCP" confusion
- [`no-code-mcp/best-practices.mdx`](docs/no-code-mcp/best-practices.mdx) -- 10+ mentions, FAQ section needs careful rewrite (e.g. "Can I use MCP Pay with any MCP server?" -> "Can I use the no-code MCP integration with any MCP server?", "Can I migrate from MCP Pay to SDK integration later?" -> "Can I migrate from the no-code path to SDK integration later?")

### In-passing references across the rest of docs

Update each per the naming canon. The MCP-Pay-centric guide stays as a guide:

- [`guides/monetize-mcp-server-no-code.mdx`](docs/guides/monetize-mcp-server-no-code.mdx) -- description, body, links into `/no-code-mcp/*`. Filename can stay (it's task-shaped already)
- [`index.mdx`](docs/index.mdx) lines 4, 47 -- description and hero copy (e.g. hero copy becomes "...add SolvaPay to your MCP server with no code, or integrate with the TypeScript SDK")
- [`get-started/choose-your-path.mdx`](docs/get-started/choose-your-path.mdx) -- description, "Path B" heading -> "Path B: no-code MCP integration", comparison table headers (`| Feature | TypeScript SDK | No-code MCP integration |`), links (lines 3, 11, 15, 46-48, 58-60, 64)
- [`get-started/create-product.mdx`](docs/get-started/create-product.mdx) line 55
- [`get-started/test-in-sandbox.mdx`](docs/get-started/test-in-sandbox.mdx) lines 12, 32, 36, 93
- [`get-started/go-live.mdx`](docs/get-started/go-live.mdx) lines 14, 90
- [`guides/use-agent-skill.mdx`](docs/guides/use-agent-skill.mdx) lines 23, 27, 82
- [`guides/monetize-mcp-server-with-sdk.mdx`](docs/guides/monetize-mcp-server-with-sdk.mdx) line 12
- [`guides/manage-account-with-admin-mcp.mdx`](docs/guides/manage-account-with-admin-mcp.mdx) line 40 (link)
- [`mcp-server/getting-started.mdx`](docs/mcp-server/getting-started.mdx) lines 44, 48 -- the "Admin MCP Server vs MCP Pay" section becomes "Admin MCP Server vs no-code MCP integration" (or rephrased entirely)
- [`mcp-server/testing-auth-and-paywall.mdx`](docs/mcp-server/testing-auth-and-paywall.mdx) lines 7, 13, 22, 71
- [`sdks/typescript/setup/cli.mdx`](docs/sdks/typescript/setup/cli.mdx) line 64
- [`webhooks.mdx`](docs/webhooks.mdx) lines 513-514, 580-581 (e.g. "...customer is created through MCP Pay hosted OAuth..." -> "...customer is created through the no-code MCP integration's hosted OAuth..." vs "...integrate with the TypeScript SDK (instead of using the no-code MCP integration)...")

### OpenAPI text only (NOT field rename)

[`api-reference/openapi.json`](docs/api-reference/openapi.json):

- L1798-1800: rewrite description from `"Whether this product uses MCP Pay proxy"` -> `"Whether SolvaPay is added in front of this MCP server (no-code reverse-proxy integration). Note: this field will be renamed to isNoCodeMcp in a future major version."`
- L3604: GET `/v1/sdk/products` description -- replace `"MCP Pay flag"` -> `"No-code MCP integration flag"`
- L3651-3653: query param description `"Filter MCP Pay products"` -> `"Filter products that use the no-code MCP integration"`
- **Field name `isMcpPay` stays** (L614-616, L1798, L1861, L3651) -- contract stability. Future rename target (`isNoCodeMcp`) is documented inline as the deprecation note above

Note: this OpenAPI file in docs is checked in but may be auto-synced from the backend (check `docs/scripts/`). **Action item: verify before editing.** If synced, the rewrite happens in the backend OpenAPI generation (which is *out of scope* for this plan, see follow-up). If hand-maintained, edit directly.

### Contributor + repo metadata

- [`AGENTS.md`](docs/AGENTS.md) lines 17, 40 -- replace the contributor terminology rule. New rule: *"Use **No-code MCP integration** for the no-code reverse-proxy integration path. Use **SDK integration** for the path that uses code. Use **TypeScript SDK** for the library artifact. The phrase **add SolvaPay to your MCP server** is fine in body prose but never as a section label (it applies to both paths). Do not use **MCP Pay**, **Managed MCP**, **Hosted MCP**, or **MCP Gateway** -- they're brand-shaped or carry hosting-confusion."*
- [`README.md`](docs/README.md) line 7 -- replace `mcp-pay` with `no-code-mcp` in the docs path list
- [`internal/docs-ia-review.md`](docs/internal/docs-ia-review.md) and [`internal/docs-ownership.md`](docs/internal/docs-ownership.md) -- mechanical rename of `mcp-pay` paths and "MCP Pay" mentions to align

---

## Repo 2: `skills/`

### Folder rename + content rewrite

- Rename `skills/solvapay/mcp-pay/` -> `skills/solvapay/no-code-mcp/`
- Rewrite [`skills/solvapay/no-code-mcp/guide.md`](skills/solvapay/mcp-pay/guide.md) per the naming canon. Title: `"# No-code MCP integration guide"`. All 7 line ranges from the audit (1, 10, 20, 26-28, 41, 135-136, 153-155) rewritten. Trigger phrase list at the top (lines 26-28) becomes the canonical trigger set per naming canon

### Skill router updates

- [`skills/solvapay/SKILL.md`](skills/solvapay/SKILL.md) lines 6-8 (description), 24-28 (path index), 45-47 (guardrails), 58-60 (routing table -- update trigger phrases per canon), 73-75, 77-79
- [`skills/solvapay/AGENTS.md`](skills/solvapay/AGENTS.md) -- mirror of SKILL.md, same line numbers
- Routing table entry becomes: `| No-code MCP setup | "no-code mcp", "monetize mcp server", "bootstrap mcp", "hosted mcp monetization", "mcp paywall", "managed mcp", "mcp pay" | [no-code-mcp/guide.md](no-code-mcp/guide.md) |`

### Cross-references and supporting guides

- [`skills/solvapay/sdk-integration/mcp-server/guide.md`](skills/solvapay/sdk-integration/mcp-server/guide.md) line 7 -- update link to `../../no-code-mcp/guide.md` and rephrase to e.g. "...use the [no-code MCP integration guide](../../no-code-mcp/guide.md)". Line 83 (`McpPaywallView`) is an SDK API identifier and stays
- [`skills/solvapay/building-mcp-app/tool-design.md`](skills/solvapay/building-mcp-app/tool-design.md) line 159 (`McpPaywallView`) -- SDK identifier, stays. No change needed unless surrounding prose mentions "MCP Pay"
- [`skills/solvapay/website-checkout/guide.md`](skills/solvapay/website-checkout/guide.md) line 8 -- rephrase scope boundary to "...not the no-code MCP integration..."
- [`skills/solvapay/sdk-integration/reference.md`](skills/solvapay/sdk-integration/reference.md) line 90 -- update docs topic hint to "no-code mcp bootstrap", "create no-code mcp product"
- [`skills/solvapay/provider-onboarding/guide.md`](skills/solvapay/provider-onboarding/guide.md) lines 22, 52 -- "Hosted MCP Pay or SDK" becomes "no-code MCP integration or SDK integration"
- [`skills/solvapay/provider-onboarding/02-create-product-and-plan.md`](skills/solvapay/provider-onboarding/02-create-product-and-plan.md) line 15

---

## Repo 3: `cursor-plugin/`

The plugin vendors a copy of the skills repo at `plugins/solvapay/skills/solvapay/`. Two options:

1. Make the skills repo changes first, then re-vendor (rsync from `~/projects/solvapay/skills/skills/solvapay/` into `~/projects/solvapay/cursor-plugin/plugins/solvapay/skills/solvapay/`)
2. Make changes in both places manually

Recommend option 1 (re-vendor) since it's more reliable and skill content should stay byte-identical between the two repos. Confirm vendoring direction before starting -- there is no automated sync script in `cursor-plugin/scripts/` that pulls from the skills repo, only [`scripts/sync-local.sh`](cursor-plugin/scripts/sync-local.sh) which copies the plugin out to `~/.cursor/plugins/local/`.

### Plugin manifest

- [`plugins/solvapay/.cursor-plugin/plugin.json`](cursor-plugin/plugins/solvapay/.cursor-plugin/plugin.json) line 28 -- replace keyword `"mcp-pay"` with `"no-code-mcp"`. Optionally also add `"managed-mcp"` for discovery (users searching for that term)
- [`plugins/solvapay/README.md`](cursor-plugin/plugins/solvapay/README.md) line 39 -- mentions "MCP paywall" (lowercase), keep as-is (refers to the paywall feature, not the brand). Verify other mentions in README don't say "MCP Pay"
- Top-level [`README.md`](cursor-plugin/README.md) -- already audited, no "MCP Pay" string. Confirm during execution

### Vendored skill content

- All files under `plugins/solvapay/skills/solvapay/` get the same updates as the skills repo (or re-vendored from skills repo after that's done)
- Folder rename `plugins/solvapay/skills/solvapay/mcp-pay/` -> `plugins/solvapay/skills/solvapay/no-code-mcp/`

---

## Validation

- `docs/`: run `mint broken-links` (per [`docs/AGENTS.md`](docs/AGENTS.md)) to catch any links not updated by the redirects
- `docs/`: ripgrep for `mcp.?pay` (case-insensitive) to confirm zero remaining product-name references outside the OpenAPI field name and any explicitly retained occurrences (e.g. trigger-phrase lists in skills)
- `docs/`: ripgrep for `managed.?mcp`, `hosted.?mcp`, `mcp.?gateway` -- expect zero matches (we deliberately rejected these names)
- `skills/`: ripgrep for `mcp.?pay` -- expect zero matches in prose; `McpPaywallView` (SDK API identifier) is the only allowed match. Trigger-phrase lists may legitimately contain `mcp pay` strings as discovery hooks
- `cursor-plugin/`: ripgrep for `mcp.?pay` -- expect zero matches except `McpPaywallView` and the lowercase "MCP paywall" in README and trigger-phrase lists in vendored skill
- Run [`scripts/validate-template.mjs`](cursor-plugin/scripts/validate-template.mjs) to verify plugin manifest still parses
- Sync the plugin locally via [`scripts/sync-local.sh`](cursor-plugin/scripts/sync-local.sh) and smoke-test that the skill loads in Cursor

---

## Execution order

1. Verify the OpenAPI source-of-truth question (docs vs backend) before touching `api-reference/openapi.json`
2. `skills/` first (canonical content -- agents use it to generate docs / answer user questions)
3. `cursor-plugin/` second (re-vendor from skills + manifest update)
4. `docs/` third (largest surface, includes folder rename + redirects)
5. Run validation across all three repos

This ordering means the skill is updated before the docs themselves -- so any in-flight assistant queries route to the new naming immediately.
