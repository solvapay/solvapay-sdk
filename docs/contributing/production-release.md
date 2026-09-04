# Production language release (merge-to-main)

Documentation only — no automation is wired yet. Downstream publish jobs
already exist. The missing piece is creating the production tags that
start them.

## What already works

Each language workflow publishes for real on a production tag. Channel
comes from the git ref (`resolveChannelFromRef` in
[`release-channel.ts`](../../tools/repo/lib/release-channel.ts)). For
example [`publish-python.yml`](../../.github/workflows/publish-python.yml)
gates PyPI Trusted Publishing on
`github.event_name == 'push' && startsWith(github.ref, 'refs/tags/solvapay-python-v')`.

The same pattern holds for Rust (crates.io), Ruby (RubyGems), and Go
(`solvapay/solvapay-go`). Rehearsal tags (`rehearsal/solvapay-<lang>-v*`)
never match those globs.

Nothing in [`publish.yml`](../../.github/workflows/publish.yml) currently
creates `solvapay-<lang>-v*` tags.

## Proposed wiring (do not implement here)

Add a step on the publish leg of `publish.yml`, beside **Verify published
packages landed on npm**, gated on
`steps.changesets.outputs.published == 'true'`. That step pushes
`trainTags(version, 'production')` from `release-channel.ts` using the
release-bot App token.

Enable one ecosystem at a time. Crates.io last — publish order is
`solvapay-export` → `solvapay-dto` → `solvapay-core` →
`solvapay-mcp-core` → `solvapay-transport` → `solvapay`
(`tools/repo/check-publish-graph.sh`).

## Prerequisites

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

Publishes are irreversible. crates.io, PyPI, and RubyGems do not reuse a
version. A half-pushed tag set leaves the train split across registries:
one language is live at `0.2.0` while another never left the previous
sentinel.

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
