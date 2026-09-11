# Language preview publishing

Operating guide for Rust, Python, Ruby and Go previews: how to trigger them,
what the local runner can and cannot cover, and how to install what was
published. The model behind them — channels, registries, version grammars,
credentials — is
[release-and-publishing.md](./release-and-publishing.md#channel-matrix).

Previews publish through the **rehearsal** channel, and the channel comes from
the git ref only. A `workflow_dispatch` on a language publish workflow can never
select rehearsal.

## Dispatch

**Normal path: [`publish-preview.yml`](../../.github/workflows/publish-preview.yml)
with `dry_run=false`.** That single dispatch runs the npm preview and then
pushes all four `rehearsal/solvapay-<lang>-v<sentinel>` tags with the
release-bot App token, which starts the four language workflows. Set
`include_languages=false` for an npm-only preview.

It always passes `--replace`, because the tags are keyed on the sentinel rather
than the run, so re-previewing the same sentinel is expected to work. Artifact
versions still carry `<run>`, so a new publish never collides with a previous
preview.

**Language-only path:
[`push-rehearsal-tags.yml`](../../.github/workflows/push-rehearsal-tags.yml).**
Use it to re-run the language matrix without publishing npm.

1. Open **Actions → Push rehearsal tags**.
2. Leave **version** empty to use the sentinel, or set an explicit `X.Y.Z` that
   `trainTags` will accept.
3. Leave **replace** off on the first run for a sentinel. The script fails if
   any of the four tags already exist on origin.
4. Run it on the SHA you want previewed.
5. Confirm each language job reaches its install-smoke step.

**From a maintainer checkout**, when you want CI to run the matrix from a
feature branch (tag pushes run the workflow from the tagged commit, unlike
`workflow_dispatch`, which requires the workflow file on `main`):

```bash
pnpm exec tsx tools/repo/push-rehearsal-tags.ts
pnpm exec tsx tools/repo/push-rehearsal-tags.ts --replace
pnpm exec tsx tools/repo/push-rehearsal-tags.ts --version 0.1.0 --replace
```

`--replace` deletes only existing `rehearsal/` tags, then re-pushes them at
`HEAD`. The script refuses to delete any tag that does not start with
`rehearsal/`. You need push access and a remote that can fire the tag workflows.

`<run>` in every published version is `github.run_number` of the **language**
workflow that published, not of the tag-push job.

## Why the tag matrix is the authoritative check

One Mac cannot build every wheel and gem family. Windows needs Windows runners,
and Docker Desktop Rosetta cannot run musl amd64 images. Only the language
publish workflows on a rehearsal tag cover Python (every wheel family, including
both Windows runners), Ruby (every platform via `rb-sys-dock` on
`ubuntu-latest`), Rust (the crates.io graph against an in-job registry) and Go
(nested-module tag plus public-proxy smoke).

Locally, `pnpm checks:release-train` must pass first — Cargo, `pyproject.toml`
and the Ruby manifests all have to match the sentinel.

## Run a preview locally

The local runner is the fast inner loop, not a substitute for the rehearsal-tag
matrix. `pnpm preview` runs build → artifact gate → rehearsal publish →
install-smoke from your machine. It publishes to the real rehearsal targets with
local tokens. It **does not push git tags**, so it never starts a workflow.

At the end it prints a coverage report: `built N/M`, then one line per uncovered
family with the reason and the CI job that does cover it. A partial host exits
non-zero unless you pass `--accept-partial`.

```bash
pnpm dryrun                  # npm release:dryrun, then this preview --dry-run --accept-partial
pnpm preview                 # rust + python + ruby + go
pnpm preview:rust
pnpm preview:python
pnpm preview:ruby
pnpm preview:go
pnpm preview --dry-run       # build + gates only; no publish
pnpm preview --accept-partial # allow uncovered families (Windows, musllinux-x86_64)
pnpm preview --only go --run 1700000000
pnpm preview:python --zig    # Linux wheels via maturin --zig instead of Docker
pnpm preview:python --arch macos   # one host wheel + sdist; skip Linux/Windows families
pnpm preview:ruby --arch macos     # both Darwin gems via dock-build; skip Linux families
```

`--run` defaults to `floor(now/1000)` so a local artifact version cannot collide
with CI's small `github.run_number`. `--version` defaults to the release-train
sentinel.

### Local tokens

Fail before any build when a selected language is missing its token (except
`--dry-run`, which never publishes).

| Language | Token                     | Notes                                                                                               |
| -------- | ------------------------- | --------------------------------------------------------------------------------------------------- |
| Rust     | none                      | Ephemeral `cargo-http-registry` on `127.0.0.1:8000`                                                 |
| Python   | `SOLVAPAY_TESTPYPI_TOKEN` | TestPyPI project API token for `solvapay` and `solvapay-mcp`. OIDC Trusted Publishing is CI-only.   |
| Ruby     | `GEM_HOST_API_KEY`        | GitHub PAT with `write:packages`                                                                    |
| Go       | none                      | Local preview is verification-only (wasm + `go build`/`vet` + replace smoke). Real rehearsal is CI. |

### Local prerequisites

- Docker, for the Python manylinux/musllinux cross images
  (`ghcr.io/rust-cross/manylinux2014-cross:x86_64` and the arm64 pypa images)
  and for every Ruby platform gem via `dock-build.sh`, including Darwin
  (`rbsys/arm64-darwin` and `rbsys/x86_64-darwin`; the latter is `linux/amd64`
  and runs under Rosetta). On Apple Silicon, `musllinux-x86_64` is not buildable
  under Docker Desktop Rosetta; `--zig` is the only local path and needs `zig`
  plus the matching `rustup` targets.
- `rustup target add wasm32-wasip1` (Go), and
  `x86_64-apple-darwin aarch64-apple-darwin` (Python universal2).
- `cargo-http-registry` on `PATH` for Rust (`cargo install cargo-http-registry`).

### Windows wheels

`win_amd64` and `win_arm64` need Windows runners. The local runner marks them
unavailable, passes `--allow-missing` for those families, and fails the run
unless `--accept-partial` is set. CI never passes `--allow-missing`.

The runner stamps version files, then restores them with `git checkout --` in
`finally` (including Ctrl-C). It never writes `~/.gitconfig`,
`.cargo/config.toml`, or `~/.gem/credentials` — Go fetch, cargo registry, and
`gem push` use process-scoped env.

## Install a preview

Read `<run>` from the language workflow run that published, not from the
tag-push job.

### Python

```bash
python -m pip install --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ \
  "solvapay==0.1.0.dev<run>"
```

`solvapay-mcp` uses the same index and version. The CI smoke is
[`sdks/python/scripts/install-smoke.py`](../../sdks/python/scripts/install-smoke.py).

### Ruby

```bash
gem install solvapay --version 0.1.0.pre.<run> \
  --clear-sources --source https://rubygems.pkg.github.com/solvapay
```

GitHub Packages needs an authenticated `gem` source (a token with
`read:packages`). The CI smoke is
[`sdks/ruby/scripts/install-smoke.rb`](../../sdks/ruby/scripts/install-smoke.rb).

### Go

```bash
go get github.com/solvapay/solvapay-sdk/sdks/go@v0.1.0-rehearsal.<run>
```

`@latest` never selects the prerelease. Pin the exact `vX.Y.Z-rehearsal.N` tag
from the language workflow that published it.

### Rust

There is no durable preview crate. The rehearsal registry lives only for the
`publish-rust.yml` job. Use that job's install-smoke log as the proof, or publish
a production crate from a `solvapay-rust-v*` tag.
