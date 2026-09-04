# Production language release (merge-to-main)

Merging the Version Packages PR to `main` is the production path for
**TypeScript, Python, Rust, Ruby, and Go**. That push re-runs
[`publish.yml`](../../.github/workflows/publish.yml).
`changesets/action` takes the publish branch.

| Language               | How this same job ships it                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| TypeScript             | In-process: `pnpm changeset:publish` to npm `@latest`, then verify. No `solvapay-typescript-v*` tag. |
| Python, Rust, Ruby, Go | Next step: push `solvapay-<lang>-v<sentinel>` so `publish-*.yml` runs.                               |

TypeScript-only Version Packages merges still publish npm. They do **not**
push language tags when `@solvapay/release-train` is unchanged.

When the sentinel _does_ move, the intended end state is all four language
tags from that same merge — one production train. Repo variables
(`RELEASE_PROD_*`) are a temporary rollout kill-switch so a registry
without trusted publishing does not hard-fail the train. They are not a
decision that only some languages belong on `main`. Default unset/false
until that registry’s prerequisite is live.

## Sentinel-moved rule

`@solvapay/release-train` is `private` with `privatePackages: { version: true, tag: false }`.
A TypeScript-only release still sets `published == 'true'` while the
sentinel stays put. Pushing `trainTags('0.1.0', 'production')` would then
fail `assertTagsAvailable`.

The script compares `readReleaseTrainVersion()` at `HEAD` with first-parent
`HEAD^` (`git show HEAD^:internal/release-train/package.json`). Equal
versions → log and exit 0. Do not infer the sentinel from
`publishedPackages` — Changesets will never list it.

The step is still gated on `steps.changesets.outputs.published == 'true'`
so the Version Packages _open_ leg never runs the script.

## Token

Tag push uses the `solvapay-release-bot` App token (same pattern as
[`push-rehearsal-tags.yml`](../../.github/workflows/push-rehearsal-tags.yml)):

```bash
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
```

`GITHUB_TOKEN` must be `steps.app-token.outputs.token`. The job default
token is `contents: read` and would not trigger `on: push` tag workflows
even if it could write.

## Per-language rollout (`vars`)

Settings → Variables (default unset/false):

- `RELEASE_PROD_PYTHON`
- `RELEASE_PROD_RUBY`
- `RELEASE_PROD_GO`
- `RELEASE_PROD_RUST`

Treat `true` / `1` as on. If the sentinel moved and none are on, the
script exits 0 and logs that nothing was tagged.

Suggested enable order after rehearsal is green and the matching trusted
publisher / token exists: Python → Ruby → Go → Rust last (crates.io
ordered graph: `solvapay-export` → `solvapay-dto` → `solvapay-core` →
`solvapay-mcp-core` → `solvapay-transport` → `solvapay`,
`tools/repo/check-publish-graph.sh`).

`assertTagsAvailable` applies only to the languages being pushed. There
is no `--replace` on the production path.

Channel still comes from the git ref (`resolveChannelFromRef` in
[`release-channel.ts`](../../tools/repo/lib/release-channel.ts)). For
example [`publish-python.yml`](../../.github/workflows/publish-python.yml)
gates PyPI Trusted Publishing on
`github.event_name == 'push' && startsWith(github.ref, 'refs/tags/solvapay-python-v')`.
Rehearsal tags (`rehearsal/solvapay-<lang>-v*`) never match those globs.

## Prerequisites (operator, not the tag-push PR)

- **PyPI Trusted Publishing** for both `solvapay` and `solvapay-mcp` on
  `publish-python.yml`.
- **RubyGems trusted publisher** for `publish-ruby.yml`.
- **`CARGO_REGISTRY_TOKEN`** (or crates.io Trusted Publishing) for
  `publish-rust.yml`.
- **`SOLVAPAY_GO_DEPLOY_TOKEN`** with `contents: write` on
  `solvapay/solvapay-go`.
- Crates.io publish order confirmed by `pnpm` /
  `tools/repo/check-publish-graph.sh`.

## Risks

Tag pushes are not atomic across registries. A later language can fail
after an earlier one already accepted the version. The vars switch is
the mitigation: only one ecosystem live per train bump until the set is
trusted.

crates.io, PyPI, and RubyGems do not reuse a version.

Rehearse first via
[language-previews.md](./language-previews.md)
(`pnpm exec tsx tools/repo/push-rehearsal-tags.ts --replace`). That is
the full OS/arch matrix. Do not treat `pnpm preview` on a laptop as
coverage.

## Darwin gems go through `dock-build.sh`

Native macOS `rake native gem` yields one ABI and a version-locked
`arm64-darwin-25` platform string. CI and the local preview therefore
build both Darwin rows with `rb-sys-dock` on Linux (`ubuntu-latest` /
Docker), same as the gnu Linux rows. `RbSys::ExtensionTask` derives
`native:*-darwin` from `RUBY_TARGET`; the old hardcoded
`cross_platform` list was what made those tasks look missing.

`dock-build.sh` runs `rustup target add` inside the container so the
`rust-toolchain.toml` 1.96.0 pin gets the matching cross std.
