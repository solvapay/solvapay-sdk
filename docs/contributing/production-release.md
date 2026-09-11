# Production language release (merge-to-main)

Mechanics of the production language tag push. The full production path — gates,
registries, credentials, enablement order — is
[release-and-publishing.md](./release-and-publishing.md#production).

Merging the Version Packages PR to `main` re-runs
[`publish.yml`](../../.github/workflows/publish.yml). `changesets/action` takes
the publish branch, ships npm `@latest` in-process, and then
`push-production-tags.ts` pushes `solvapay-<lang>-v<sentinel>` for each language
whose `vars.RELEASE_PROD_*` is on. TypeScript never gets a
`solvapay-typescript-v*` tag; it publishes inside that same job.

## Sentinel-moved rule

`@solvapay/release-train` is `private` with
`privatePackages: { version: true, tag: false }`. A TypeScript-only release
still sets `published == 'true'` while the sentinel stays put. Pushing
`trainTags('0.1.0', 'production')` would then fail `assertTagsAvailable`.

The script compares `readReleaseTrainVersion()` at `HEAD` with first-parent
`HEAD^` (`git show HEAD^:internal/release-train/package.json`). Equal versions →
log and exit 0. Do not infer the sentinel from `publishedPackages` — Changesets
will never list it.

The step is still gated on `steps.changesets.outputs.published == 'true'` so the
Version Packages _open_ leg never runs the script.

`assertTagsAvailable` applies only to the languages being pushed. There is no
`--replace` on the production path — that flag exists solely for rehearsal tags,
which are keyed on the sentinel rather than the run.

## Token

The tag push uses the `solvapay-release-bot` App token, same pattern as
[`push-rehearsal-tags.yml`](../../.github/workflows/push-rehearsal-tags.yml):

```bash
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
```

`GITHUB_TOKEN` must be `steps.app-token.outputs.token`. The job default token is
`contents: read`, and even with write it would not trigger `on: push` tag
workflows.

## Channel comes from the ref

`resolveChannelFromRef` in
[`release-channel.ts`](../../tools/repo/lib/release-channel.ts) is the only
input. For example [`publish-python.yml`](../../.github/workflows/publish-python.yml)
gates PyPI Trusted Publishing on
`github.event_name == 'push' && startsWith(github.ref, 'refs/tags/solvapay-python-v')`.
Rehearsal tags (`rehearsal/solvapay-<lang>-v*`) never match those globs.

## Darwin gems go through `dock-build.sh`

Native macOS `rake native gem` yields one ABI and a version-locked
`arm64-darwin-25` platform string. CI and the local preview therefore build both
Darwin rows with `rb-sys-dock` on Linux (`ubuntu-latest` / Docker), same as the
gnu Linux rows. `RbSys::ExtensionTask` derives `native:*-darwin` from
`RUBY_TARGET`; the old hardcoded `cross_platform` list was what made those tasks
look missing.

`dock-build.sh` runs `rustup target add` inside the container so the
`rust-toolchain.toml` 1.96.0 pin gets the matching cross std.
