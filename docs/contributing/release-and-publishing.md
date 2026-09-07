# Release and publishing

The canonical spec for how this monorepo publishes. It covers both channels
(**preview** and **production**), all five ecosystems (npm, Python, Ruby, Rust,
Go), which registry each channel targets, how a release is triggered, and the
one-time credential setup each registry needs.

Companion documents, none of which restate this one:

- [publishing.mdx](../publishing.mdx) — short overview plus the npm-divergence history.
- [production-release.md](./production-release.md) — production-tag mechanics (sentinel-moved rule, token, Darwin gems).
- [language-previews.md](./language-previews.md) — the local `pnpm preview` runner and per-language install commands.
- [release-sandbox.md](./release-sandbox.md) — private fork for rehearsing the merge-to-`main` path.
- [.github/workflows/README.md](../../.github/workflows/README.md) — per-workflow notes and troubleshooting.

Changeset authoring rules (bump levels, `workspace:^` peers) live in
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## The shared model

Two channels, one shape each.

|                     | Preview                                                                                            | Production                                              |
| ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Trigger             | Dispatch [`publish-preview.yml`](../../.github/workflows/publish-preview.yml) with `dry_run=false` | Merge the **Version Packages** PR into `main`           |
| npm dist-tag        | `@preview`                                                                                         | `@latest`                                               |
| Language channel    | `rehearsal`                                                                                        | `production`                                            |
| Language registries | Sandbox hosts (TestPyPI, GitHub Packages, in-job cargo registry)                                   | Real registries (PyPI, RubyGems.org, crates.io)         |
| Reversible          | Yes — snapshot versions are disposable                                                             | No — crates.io, PyPI and RubyGems never reuse a version |

Nothing publishes on a push to `dev`. `publish-preview.yml` is
`workflow_dispatch` only, and the only automatic publish anywhere is npm
`@latest` on push to `main`.

**Channel is derived from the git ref, never from a dispatch input.**
`resolveChannelFromRef` in
[release-channel.ts](../../tools/repo/lib/release-channel.ts) returns
`rehearsal` for refs under `rehearsal/` and `production` for everything else.
A `workflow_dispatch` on a language publish workflow can therefore never select
the rehearsal channel — it can only choose whether to publish at all
(`publish_to_pypi`, `publish_to_rubygems`, `publish_to_crates_io`,
`publish_to_go`, all default `false`).

`assertHostMatchesChannel` enforces the pairing, so a rehearsal run cannot
reach a production host. Go is the documented exception: both channels tag the
same repository, and the channel is carried by the `-rehearsal.<run>`
prerelease suffix instead of a different host.

## Two version systems

**npm — independent per-package semver, owned by Changesets.** Each
`@solvapay/*` package bumps on its own from the `.changeset/*.md` files merged
alongside the code. [`.changeset/config.json`](../../.changeset/config.json) is
the source of truth: `linked: []`, `access: public`,
`updateInternalDependencies: patch`, examples and demo apps in `ignore`.

**Rust, Python, Ruby and Go — one lockstep version.** The single version is
owned by the private sentinel package
[`@solvapay/release-train`](../../internal/release-train/package.json)
(currently `0.1.0`). `pnpm changeset:version` runs
`tools/repo/sync-release-train.ts`, which stamps that version into
`Cargo.toml`, `pyproject.toml` and `version.rb`. A PR touching `core/**` or a
non-TypeScript `sdks/**` surface must include a `@solvapay/release-train`
changeset; `pnpm checks:release-train-changeset` gates it, and
`pnpm checks:release-train` verifies the stamped manifests still match.

The sentinel is `private` with `privatePackages: { version: true, tag: false }`,
so it is versioned but never published or tagged. Changesets will never list it
in `publishedPackages` — which is why the production tag push compares the
sentinel at `HEAD` against `HEAD^` rather than reading the publish output. See
[production-release.md](./production-release.md#sentinel-moved-rule).

## Channel matrix

Hosts come from `PRODUCTION_HOSTS` / `REHEARSAL_HOSTS`, and version grammars
from `ecosystemVersion`, both in
[release-channel.ts](../../tools/repo/lib/release-channel.ts).

| Ecosystem                    | Production registry                       | Production version                  | Preview registry                                       | Preview version                     |
| ---------------------------- | ----------------------------------------- | ----------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| npm                          | registry.npmjs.org, `@latest`             | per-package semver                  | registry.npmjs.org, `@preview`                         | `0.0.0-preview-<shortsha>`          |
| Python                       | PyPI (`solvapay`, `solvapay-mcp`)         | `<sentinel>`                        | TestPyPI                                               | `<sentinel>.dev<run>`               |
| Ruby                         | RubyGems.org (`solvapay`, `solvapay-mcp`) | `<sentinel>`                        | GitHub Packages `rubygems.pkg.github.com/solvapay`     | `<sentinel>.pre.<run>`              |
| Rust                         | crates.io, 6 crates in graph order        | `<sentinel>`                        | in-job `cargo-http-registry` on `127.0.0.1:8000`       | `<sentinel>-rehearsal.<run>`        |
| Go                           | `sdks/go/v<sentinel>` tag on this repo    | `v<sentinel>`                       | `sdks/go/v<sentinel>-rehearsal.<run>` tag on this repo | `v<sentinel>-rehearsal.<run>`       |
| npm native platform packages | registry.npmjs.org                        | `@solvapay/server-native`'s version | registry.npmjs.org                                     | `@solvapay/server-native`'s version |

`<run>` is `github.run_number` **of the language workflow that published**, not
of the run that pushed the tag. Read it from the language workflow run.

crates.io publish order is `solvapay-export` → `solvapay-dto` →
`solvapay-core` → `solvapay-mcp-core` → `solvapay-transport` → `solvapay`,
encoded in `tools/repo/crates-publish.sh` and verified by
`tools/repo/check-publish-graph.sh`.

Two npm details that the table flattens:

- The `rehearsal` npm host in `release-channel.ts` is a local Verdaccio
  (`127.0.0.1:4873`), used only by
  [`rehearsal-npm.yml`](../../.github/workflows/rehearsal-npm.yml). The
  practical npm preview is the `@preview` dist-tag on the real registry, which
  that module does not model as a channel.
- `@preview` is a **mutable pointer**. Snapshot versions
  (`0.0.0-preview-<shortsha>`) are immutable, but the tag moves on every
  preview publish.

## The native platform packages

`@solvapay/server` has no JavaScript fallback on Node: it loads
`@solvapay/server-native`, a thin loader whose eight `optionalDependencies` are
the per-platform binaries.

```
@solvapay/server-native-darwin-x64        @solvapay/server-native-linux-x64-musl
@solvapay/server-native-darwin-arm64      @solvapay/server-native-linux-arm64-musl
@solvapay/server-native-linux-x64-gnu     @solvapay/server-native-win32-x64-msvc
@solvapay/server-native-linux-arm64-gnu   @solvapay/server-native-win32-arm64-msvc
```

The set is declared once in
[`contract/manifest/support-matrix.yaml`](../../contract/manifest/support-matrix.yaml)
under `nodeNative.targets`; every script and both publish workflows read it from
there. Platform and ABI coverage: [platform-support.mdx](../platform-support.mdx).

In git, the loader's `optionalDependencies` are committed as `file:npm/<dir>`
paths, which is the correct dev-time state. `.node` binaries are gitignored, so
a publish must rebuild them. Both publish workflows therefore run the same
sequence before Changesets publishes anything:

1. [`native-build.yml`](../../.github/workflows/native-build.yml) — a
   `workflow_call` reusable workflow with the 8-target napi matrix
   (`--use-napi-cross` for linux-gnu, `--cross-compile` plus zig for musl,
   native runners for darwin and windows). Uploads `bindings-<rustTriple>`
   artifacts.
2. `napi create-npm-dirs`, artifact download, `napi artifacts` — places each
   `.node` into `sdks/node-native/npm/<dir>/`.
3. `sdks/node-native/scripts/check-artifacts.mjs` — refuses to continue if a
   platform binary is missing.
4. `tools/repo/prepare-native-publish.ts` — rewrites every `file:npm/*` spec to
   a semver pin at the loader's current version.
5. `tools/repo/publish-native-platform-packages.ts` — publishes the eight. It
   skips any package whose exact version is already on the registry, so a
   mid-run failure is recoverable by re-running.
6. **Gate B** — `tools/repo/verify-native-platform-publishes.ts` probes
   `GET https://registry.npmjs.org/<name>/<version>` for all eight, with a
   10-minute retry window for registry propagation.
7. **Gate A** — `tools/repo/check-release-dryrun.ts --assert-no-local-paths`
   fails if any publishable package still carries a `file:` / `link:` /
   `portal:` production dependency.

Gate A proves the specs were rewritten; Gate B proves the packages those specs
now point at actually exist. Both are needed: without them a publish ships a
loader whose `optionalDependencies` reference paths that do not exist on a
consumer's machine, and every other gate passes.

`@solvapay/server-wasm` needs none of this. Its `build` script only verifies
the committed `pkg/` artifacts, which are in git, and it lands in the same
`changeset publish` batch as `@solvapay/server`.

## Preview

One dispatch previews all five ecosystems.

1. **Actions → Publish Preview Snapshot** →
   [`publish-preview.yml`](../../.github/workflows/publish-preview.yml).
2. Inputs: `dry_run` (default `true`), `force_native` (default `false`), and
   `include_languages` (default `true`). Set `dry_run=false` for a real preview.
   Set `include_languages=false` for an npm-only preview. `force_native` is
   dry-run only: it runs the 8-target native matrix without publishing.
3. The workflow must exist on the default branch for dispatch to be enabled;
   inputs then resolve against the dispatched ref, so a feature branch can be
   dry-run before merge.

What a real run does, in order:

1. Install, then read the release-train sentinel into a step output. This
   happens **before** the snapshot step on purpose:
   `privatePackages: { version: true }` means `changeset version --snapshot`
   rewrites the sentinel to `0.0.0-preview-<sha>` in the working tree, and
   `parseSemver` accepts only strict `X.Y.Z`.
2. Gates: `deps:check`, `build:packages`, `test`, `validate:fetch-runtime`, and
   the Deno workspace gate
   (`pnpm --filter @example/supabase-edge-mcp validate:workspace`).
3. `changeset version --snapshot preview`.
4. The full native sequence above (steps 1–7). The eight platform packages are
   published at whatever version `sdks/node-native/package.json` carries after
   step 3 — the `0.0.0-preview-<sha>` snapshot when the loader is in the
   snapshot batch, its committed version when it is not. Either way the loader's
   `optionalDependencies` are pinned to the same version, so the tarball is
   self-consistent.
5. `changeset publish --tag preview --no-git-tag`.
6. `tools/repo/verify-npm-publishes.mjs` against the publish log.
7. The post-publish Deno gate against the published `@preview` tarballs. This
   runs _after_ the publish deliberately — it is the only check that exercises
   assembled npm tarballs, but gating the publish on it once deadlocked
   `@preview` for eight days.
8. When `include_languages` is on:
   `push-rehearsal-tags.ts --version <sentinel> --replace` pushes the four
   `rehearsal/solvapay-<lang>-v<sentinel>` tags with the `solvapay-release-bot`
   App token (minted in the job's first step), which fires the four language
   workflows.

`--replace` is required on this path. The four tags are keyed on the sentinel,
not the run, so a second preview of the same sentinel would otherwise fail
`assertTagsAvailable`. Published artifact versions still carry `<run>`, so
previews never collide. The script refuses to delete any tag not prefixed
`rehearsal/`.

The App token is required for a non-obvious reason: **a tag pushed with the
default `GITHUB_TOKEN` does not fire `on: push` tag workflows.** The job keeps
`permissions: contents: read`; the App token carries the write.

With `dry_run=true` the workflow runs the gates, then `changeset status` plus
`pnpm -r publish --dry-run`, and prints the four rehearsal tags. It does not
push them and does not fail if they already exist on origin — the npm dry-run
never posts language previews. No `NPM_TOKEN`, no App token. The native matrix
stays skipped unless `force_native=true`, which still publishes those packages
with `--dry-run`.

**Cost.** A non-dry-run preview with languages on runs 8 native builds, 7 Python
wheel platforms and 4 Ruby dock gems. `include_languages=false` opts out of the
language half.

[`push-rehearsal-tags.yml`](../../.github/workflows/push-rehearsal-tags.yml)
still exists as a standalone entry point for re-running the language matrix
without an npm publish.

## Production

Production is a merge, not a dispatch.

1. Merge work into `main` with its changesets. `publish.yml` runs and
   `changesets/action` opens or updates the **Version Packages** PR, authored by
   `solvapay-release-bot[bot]`.
2. Review that PR as a conscious release — its body enumerates every accumulated
   changeset grouped by bump level, and merging it publishes all of it.
3. Merge it. `main` now has an empty `.changeset/` and bumped versions, so
   `publish.yml` runs again and takes the publish leg.

[`publish.yml`](../../.github/workflows/publish.yml) is three jobs:

- **`detect`** — cheap checkout that sets `publish_leg=true` when `.changeset/`
  holds no `*.md` besides `README.md`, and `native_leg=true` when that is true
  or when a dry-run dispatch sets `force_native`.
- **`native-build`** — calls `native-build.yml` when `native_leg` is true.
- **`release`** — `needs: [detect, native-build]` with
  `if: ${{ !cancelled() && needs.detect.result == 'success' && needs.native-build.result != 'failure' }}`,
  so the Version-Packages-PR leg still runs when the matrix is skipped, but a
  failed `detect` cannot skip the native steps and Gate A.

The `release` job in order:

1. Mint the `solvapay-release-bot` App token. Required because org policy
   `can_approve_pull_request_reviews: false` blocks `GITHUB_TOKEN` from creating
   PRs.
2. `check-release-dryrun.ts --registry` — the unpublished-dependency gate. It
   refuses to publish a package whose production `workspace:*` dependency is
   neither in the same batch, nor already on npm, nor on
   `UNPUBLISHED_DEP_ALLOWLIST` (currently empty). This is the only place the
   registry probe runs.
3. `deps:check`, `build:packages`, `test`, `validate:fetch-runtime`, Deno
   workspace gate.
4. The native sequence (steps 1–7 above), publish leg only.
5. `changesets/action` — `pnpm changeset:version` / `pnpm changeset:publish`,
   shipping `@latest` plus matching git tags.
6. `verify-npm-publishes.mjs` on `steps.changesets.outputs.publishedPackages`.
   npm has been observed to exit 0 when a brand-new scoped name fails to create,
   so exit codes alone are not trusted.
7. `push-production-tags.ts` — pushes `solvapay-<lang>-v<sentinel>` for each
   language whose `vars.RELEASE_PROD_*` is on, but only when the sentinel moved
   between `HEAD^` and `HEAD`. Those tags fire the language publish workflows,
   which resolve the `production` channel from the ref.

There is no dist-tag-pinned Deno gate on this workflow. It ships `@latest`, so a
`@preview` gate would validate an artifact the run did not produce and a
`@latest` gate would validate the previous release.

A `workflow_dispatch` of `publish.yml` defaults to `dry_run=true`: gates, then
`changeset status` and `pnpm -r publish --dry-run`, no `NPM_TOKEN`, no App
token, no `changesets/action`. It also prints the four production tags and fails
if any already exists on `origin`. Pending changesets keep `publish_leg` false
and skip the native matrix unless `force_native=true` (dry-run only).
Push-to-`main` is always the real path.

### Non-atomicity

Tag pushes are not atomic across registries. crates.io, PyPI and RubyGems never
reuse a version, so a language that fails after an earlier one accepted the
version cannot be retried at that version — the train has to move to the next
sentinel. The `RELEASE_PROD_*` variables are the mitigation: keep one ecosystem
live per train bump until the whole set is trusted.

Rehearse first. `pnpm preview` on a laptop is not coverage — one machine cannot
build every wheel and gem family, and Docker Desktop Rosetta cannot run musl
amd64 images.

## Credentials

### What exists and why

| Credential                                        | Where                   | Used by                                                                        |
| ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `NPM_TOKEN`                                       | Actions secret          | `publish.yml`, `publish-preview.yml` — npm publish and the 8 platform packages |
| `RELEASE_APP_ID`, `RELEASE_APP_KEY`               | Actions secrets         | Version Packages PR, rehearsal and production tag pushes                       |
| PyPI / TestPyPI trusted publishers                | pypi.org, test.pypi.org | `publish-python.yml` (OIDC, no secret)                                         |
| RubyGems trusted publishers                       | rubygems.org            | `publish-ruby.yml` production (OIDC, no secret)                                |
| `secrets.GITHUB_TOKEN`                            | built in                | `publish-ruby.yml` rehearsal → GitHub Packages, with `packages: write`         |
| crates.io trusted publishers                      | crates.io               | `publish-rust.yml` (OIDC, after a token-based first publish)                   |
| `CARGO_REGISTRY_TOKEN`                            | Actions secret          | `publish-rust.yml` fallback, deletable after crates.io Phase 2                 |
| `RELEASE_PROD_PYTHON` / `_RUBY` / `_GO` / `_RUST` | Actions **variables**   | `push-production-tags.ts` per-language kill switch                             |
| `SOLVAPAY_TESTPYPI_TOKEN`, `GEM_HOST_API_KEY`     | local shell only        | `pnpm preview`                                                                 |

Repository coordinates used in every form below: owner `solvapay`, repository
`solvapay-sdk`.

### Leave every "Environment" field blank

None of `publish-python.yml`, `publish-ruby.yml` or `publish-rust.yml` declares
an `environment:` on its publish job. Every trusted-publisher form has an
optional Environment field, and it must be left **empty**. A configured
environment the workflow never enters makes the OIDC claim mismatch, and
authentication fails with an error that does not point at the cause.

If you later add an `environment:` to one of those jobs, update the matching
publisher entry in the same change.

### PyPI and TestPyPI — 4 pending publishers, no API key

Neither `solvapay` nor `solvapay-mcp` exists on either index yet, so these are
_pending_ publishers, created from the account sidebar rather than a project
page.

1. Go to https://pypi.org/manage/account/publishing/ and add a GitHub publisher:
   PyPI project name `solvapay`, owner `solvapay`, repository `solvapay-sdk`,
   workflow filename `publish-python.yml`, environment blank.
2. Repeat on the same page for project name `solvapay-mcp`.
3. Go to https://test.pypi.org/manage/account/publishing/ and repeat both.

A pending publisher converts to a normal one on first successful upload. It does
**not** reserve the name — if someone else registers `solvapay` on PyPI first,
the pending publisher is invalidated. Both names are currently unclaimed, so do
this soon.

`publish-python.yml` already has `id-token: write` on its publish job and uses
`pypa/gh-action-pypi-publish` with `skip-existing: true`. No PyPI token secret is
needed at any point.

### RubyGems — 2 pending publishers, no API key

Enable MFA on the RubyGems account first; RubyGems refuses trusted publishing
without it.

1. Go to https://rubygems.org/profile/oidc/pending_trusted_publishers/new — gem
   name `solvapay`, owner `solvapay`, repository `solvapay-sdk`, workflow
   filename `publish-ruby.yml`, environment blank.
2. Repeat for gem name `solvapay-mcp`.

The preview channel needs nothing here: it pushes to GitHub Packages with the
built-in `secrets.GITHUB_TOKEN` and `packages: write`.

### crates.io — two-phase, and this one needs an API key

crates.io has **no pending-publisher equivalent**. The trusted-publishing form
lives on a crate's own settings page, so the crate must already exist. All six
crates are unpublished, so setup is two phases.

**Phase 1 — one-off, token required.**

1. Create a token at https://crates.io/settings/tokens with the publish-new and
   publish-update scopes.
2. Store it as the Actions secret `CARGO_REGISTRY_TOKEN`.
3. Publish all six once, in dependency order. `publish-rust.yml` already accepts
   `secrets.CARGO_REGISTRY_TOKEN` as a fallback to the OIDC token, and
   `crates-publish.sh` already encodes the order, so Phase 1 runs through the
   existing workflow rather than from a laptop.

**Phase 2 — per crate, permanent.** For each of `solvapay-export`,
`solvapay-dto`, `solvapay-core`, `solvapay-mcp-core`, `solvapay-transport` and
`solvapay`: open `https://crates.io/crates/<name>/settings` → Trusted Publishing
→ Add → GitHub → owner `solvapay`, repository `solvapay-sdk`, workflow filename
`publish-rust.yml`, environment blank.

Once all six are configured and one OIDC publish has succeeded, delete the
`CARGO_REGISTRY_TOKEN` secret.

### npm — `NPM_TOKEN` stays for now

Create an automation token with publish rights on the `@solvapay` scope from
npmjs.com → Access Tokens, and store it as the Actions secret `NPM_TOKEN`. It
expires roughly annually; a 401 in a publish workflow is usually this.

npm does support OIDC trusted publishing, but it is not a drop-in here. Three
blockers, all of which would have to be addressed together:

- It requires the `npm publish` code path. This repo publishes through
  `pnpm changeset publish`.
- It requires npm CLI 11.5.1+ on Node 24+. Both publish workflows pin Node 22.
- It breaks when `actions/setup-node` writes an `.npmrc` via `registry-url`,
  which both publish workflows currently do.

Tracked as a future improvement, not a task.

### GitHub App

`solvapay-release-bot`, installed on this repository. Store `RELEASE_APP_ID` and
`RELEASE_APP_KEY` (the full `.pem`, including the BEGIN/END lines) under
Settings → Secrets and variables → Actions → Secrets.

Two independent reasons it is not optional: org policy
`can_approve_pull_request_reviews: false` blocks `GITHUB_TOKEN` from opening the
Version Packages PR, and a tag pushed with `GITHUB_TOKEN` does not fire
`on: push` tag workflows.

### Repository variables

Under Settings → Secrets and variables → Actions → **Variables**, not Secrets:

- `RELEASE_PROD_PYTHON`
- `RELEASE_PROD_RUBY`
- `RELEASE_PROD_GO`
- `RELEASE_PROD_RUST`

`true` / `1` is on; unset or anything else is off. All four are currently unset.
If the sentinel moved and none are on, `push-production-tags.ts` exits 0 and
logs that nothing was tagged. Flip them one ecosystem at a time, once that
registry's publisher exists and rehearsal is green.

### Local-only tokens

For `pnpm preview` from a maintainer machine:

- `SOLVAPAY_TESTPYPI_TOKEN` — TestPyPI project API token for `solvapay` and
  `solvapay-mcp`. OIDC trusted publishing is CI-only.
- `GEM_HOST_API_KEY` — GitHub PAT with `write:packages`.

Rust and Go need none. Details and Docker prerequisites:
[language-previews.md](./language-previews.md#local-tokens).

## Ordered enablement checklist

Each step is safe to stop at.

1. PyPI + TestPyPI pending publishers — 4 entries.
2. First Python preview: dispatch `publish-preview.yml` with `dry_run=false`,
   confirm TestPyPI receives `<sentinel>.dev<run>` and the install smoke passes.
3. RubyGems MFA, then 2 pending publishers.
4. `RELEASE_PROD_PYTHON=true`.
5. `RELEASE_PROD_RUBY=true`.
6. `RELEASE_PROD_GO=true`.
7. crates.io Phase 1 — token, then first publish of all six in graph order.
8. crates.io Phase 2 — 6 trusted publishers, then delete
   `CARGO_REGISTRY_TOKEN`.
9. `RELEASE_PROD_RUST=true`.

## Local dry-runs

None of these publish to a production registry.

```bash
pnpm changeset                  # author a changeset
pnpm changeset status --verbose # what would publish, at what bump
pnpm checks:release-dryrun      # offline graph + prerelease + dry-run-default gates
pnpm checks:release-train       # language manifests match the sentinel
pnpm release:dryrun             # graph gate, build, test, pnpm -r publish --dry-run
pnpm dryrun                     # release:dryrun, then preview --dry-run --accept-partial
pnpm preview --dry-run          # language build + gates, no publish
pnpm docs:validate-links        # this document's links
```

`pnpm checks:release-dryrun` is offline — it does not pass `--registry`, so the
unpublished-dependency probe only runs in `publish.yml`.

`pnpm preview` without `--dry-run` publishes to the real rehearsal targets using
the local tokens above. It never pushes git tags, so it cannot start a workflow.
Full flag reference: [language-previews.md](./language-previews.md#run-a-preview-locally).

To rehearse the merge-to-`main` path itself — which cannot be proven from a
feature branch, because `publish.yml` triggers on `push: main` — use a private
sandbox fork: [release-sandbox.md](./release-sandbox.md).

## Installing a preview

```bash
# npm
pnpm add @solvapay/server@preview

# Python
python -m pip install --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ "solvapay==0.1.0.dev<run>"

# Ruby (needs an authenticated gem source: PAT with read:packages)
gem install solvapay --version 0.1.0.pre.<run> \
  --clear-sources --source https://rubygems.pkg.github.com/solvapay

# Go (@latest never selects a prerelease — pin the exact tag)
go get github.com/solvapay/solvapay-sdk/sdks/go@v0.1.0-rehearsal.<run>
```

Rust has no installable preview by design: the rehearsal registry lives only for
the duration of the `publish-rust.yml` job. Use that job's install-smoke log as
the proof.

Authentication notes and the CI smoke scripts:
[language-previews.md](./language-previews.md#install-a-preview).

## Remaining parity gaps

Named, not hidden.

- **Language production is off by default.** All four `RELEASE_PROD_*` variables
  are unset, so a sentinel bump merged to `main` publishes npm only.
- **Rust has no installable preview.** The rehearsal registry is ephemeral to
  the job. Deliberate — the alternative is a durable prerelease crate on
  crates.io.
- **Per-ecosystem version grammars.** `<sentinel>.dev<run>` (Python),
  `<sentinel>.pre.<run>` (Ruby), `<sentinel>-rehearsal.<run>` (Rust, Go). Each
  registry's own rules; `ecosystemVersion` is the single place they are encoded.
- **The registry probe runs in one workflow.** `check-release-dryrun --registry`
  is in `publish.yml` only, not `publish-preview.yml` and not `ci.yml`.
- **`rehearsal-npm.yml` is separate.** The Verdaccio npm rehearsal is not part
  of the `publish-preview.yml` dispatch and must be run on its own.
- **`ci.yml` holds its own copy of the native matrix.** It does not call
  `native-build.yml`. Migrating it renames every check from
  `node-binding (<target>)` to `node-binding / <job> (<target>)`, which breaks
  [`contract/required-checks.yaml`](../../contract/required-checks.yaml) and the
  `main` branch-protection payload. That is a coordinated maintainer change.
- **Platform packages publish without an explicit dist-tag.**
  `publish-native-platform-packages.ts` runs `npm publish` with no `--tag`, so
  npm applies `latest`. On the preview path that points the eight platform
  packages' `latest` at a `0.0.0-preview-<sha>` version. Consumers are unaffected
  — the loader pins exact versions in `optionalDependencies`, so nothing resolves
  through the dist-tag — but the tag is misleading.
