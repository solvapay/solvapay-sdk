# Language preview publishing

Rust, Python, Ruby, and Go previews publish through the **rehearsal** channel.
Channel comes from the git ref only (`resolveChannelFromRef` in
[`tools/repo/lib/release-channel.ts`](../../tools/repo/lib/release-channel.ts)).
A `workflow_dispatch` on a language publish workflow can never select rehearsal.

This is the runbook for previews on `solvapay/solvapay-sdk`. For a private
fork that also rehearses the npm Changesets path, see
[release-sandbox.md](./release-sandbox.md).

## Targets and version format

Sentinel version is [`@solvapay/release-train`](../../internal/release-train/package.json)
(currently `0.1.0`). The git tag is always
`rehearsal/solvapay-<lang>-v<sentinel>`. The published artifact adds a
per-run suffix so the same sentinel can be previewed more than once.

| Language | Workflow                                                           | Preview target                                          | Artifact version              |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------- |
| Rust     | [`publish-rust.yml`](../../.github/workflows/publish-rust.yml)     | in-job `cargo-http-registry` at `http://127.0.0.1:8000` | `<sentinel>-rehearsal.<run>`  |
| Python   | [`publish-python.yml`](../../.github/workflows/publish-python.yml) | TestPyPI (`solvapay`, `solvapay-mcp`)                   | `<sentinel>.dev<run>`         |
| Ruby     | [`publish-ruby.yml`](../../.github/workflows/publish-ruby.yml)     | GitHub Packages `rubygems.pkg.github.com/solvapay`      | `<sentinel>.pre.<run>`        |
| Go       | [`publish-go.yml`](../../.github/workflows/publish-go.yml)         | `solvapay/solvapay-go-rehearsal`                        | `v<sentinel>-rehearsal.<run>` |

`<run>` is `github.run_number` of that language workflow.

## Prerequisites

Confirm these before the first dispatch. Missing Go or Python setup fails
that language job at publish, not at tag push.

- **Go (blocking).** Create empty private `solvapay/solvapay-go-rehearsal`.
  Mint a token with `contents: write` on it and store it as repo secret
  `SOLVAPAY_GO_DEPLOY_TOKEN`.
- **Python (blocking).** On TestPyPI, create projects `solvapay` and
  `solvapay-mcp`. Add a Trusted Publisher for repo `solvapay/solvapay-sdk`,
  workflow `publish-python.yml`. OIDC only — `id-token: write` is already
  on the workflow; no PyPI token secret.
- **Ruby.** Uses `secrets.GITHUB_TOKEN` with `packages: write`. Confirm the
  org allows creating gem packages under `solvapay`.
- **Rust.** None. The registry is ephemeral to the job.

`NPM_TOKEN`, `RELEASE_APP_ID`, and `RELEASE_APP_KEY` are already required
for other release workflows. The rehearsal tag push uses the release-bot App.

Locally: `pnpm checks:release-train` must pass (Cargo / `pyproject.toml` /
Ruby manifests match the sentinel).

## Dispatch

1. Open **Actions → Push rehearsal tags**
   ([`push-rehearsal-tags.yml`](../../.github/workflows/push-rehearsal-tags.yml)).
2. Leave **version** empty to use the sentinel, or set an explicit
   `X.Y.Z` that `trainTags` will accept.
3. Leave **replace** off on the first run. The script fails if any of the
   four `rehearsal/solvapay-<lang>-v*` tags already exist on origin.
4. Run the workflow on the SHA you want previewed.
5. That job runs [`tools/repo/push-rehearsal-tags.ts`](../../tools/repo/push-rehearsal-tags.ts)
   and pushes the four tags. Each tag starts the matching `publish-*` workflow.
6. Confirm each language job reaches its install-smoke step.

To re-preview the same sentinel, dispatch again with **replace** checked.
That deletes the four remote `rehearsal/` tags, then re-pushes them at
`HEAD`. The script refuses to delete any tag that does not start with
`rehearsal/`. Artifact versions still carry `<run>`, so the new publish
does not collide with the previous preview.

### Push rehearsal tags from a maintainer checkout

This path **pushes** `rehearsal/solvapay-*-v*` tags and **does fire** the
language publish workflows. Use it when you want CI to run the matrix.

```bash
pnpm exec tsx tools/repo/push-rehearsal-tags.ts
pnpm exec tsx tools/repo/push-rehearsal-tags.ts --replace
pnpm exec tsx tools/repo/push-rehearsal-tags.ts --version 0.1.0 --replace
```

You need push access and a remote that can fire the tag workflows.

## Full matrix: push rehearsal tags

One Mac cannot build every wheel and gem family. Windows needs Windows
runners, and Docker Desktop Rosetta cannot run musl amd64 images. The
authoritative check that every OS and arch works is the language
publish workflows on a rehearsal tag.

All four workflows already fire on `rehearsal/solvapay-<lang>-v*` as well
as production tags. Tag pushes run the workflow **from the tagged
commit**, so this works from a feature branch — unlike
`workflow_dispatch`, which requires the workflow file on `main`.

```bash
pnpm exec tsx tools/repo/push-rehearsal-tags.ts --replace
```

That pushes all four `rehearsal/` tags and starts Python (every wheel
family, including both Windows runners), Ruby (every platform via
`rb-sys-dock` on `ubuntu-latest`), Rust (`cargo publish --dry-run` over
the crates.io graph), and Go (subtree split plus install smoke).
Rehearsal targets are
TestPyPI, GitHub Packages, a local cargo registry, and
`solvapay-go-rehearsal` — never a production registry
(`assertHostMatchesChannel`).

`--replace` deletes only existing `rehearsal/` tags, then re-pushes them
at `HEAD`. Use it to re-run the matrix on the same sentinel.

## Run a preview locally

The local runner is the fast inner loop, not a substitute for the
rehearsal-tag matrix. `pnpm preview` runs build → artifact gate →
rehearsal publish → install-smoke from your machine. It publishes to the
real rehearsal targets with local tokens. It **does not push git tags**,
so it never starts a workflow.

At the end it prints a coverage report: `built N/M`, then one line per
uncovered family with the reason and the CI job that does cover it. A
partial host exits non-zero unless you pass `--accept-partial`.

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

`--run` defaults to `floor(now/1000)` so a local artifact version cannot
collide with CI's small `github.run_number`. `--version` defaults to the
release-train sentinel.

### Local tokens

Fail before any build when a selected language is missing its token
(except `--dry-run`, which never publishes).

| Language | Token                      | Notes                                                                                             |
| -------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| Rust     | none                       | Ephemeral `cargo-http-registry` on `127.0.0.1:8000`                                               |
| Python   | `SOLVAPAY_TESTPYPI_TOKEN`  | TestPyPI project API token for `solvapay` and `solvapay-mcp`. OIDC Trusted Publishing is CI-only. |
| Ruby     | `GEM_HOST_API_KEY`         | GitHub PAT with `write:packages`                                                                  |
| Go       | `SOLVAPAY_GO_DEPLOY_TOKEN` | Same name as CI; `contents: write` on `solvapay/solvapay-go-rehearsal`                            |

### Local prerequisites

- Docker, for the Python manylinux/musllinux cross images
  (`ghcr.io/rust-cross/manylinux2014-cross:x86_64` and the arm64 pypa
  images) and for every Ruby platform gem via `dock-build.sh`, including
  Darwin (`rbsys/arm64-darwin` and `rbsys/x86_64-darwin`; the latter is
  `linux/amd64` and runs under Rosetta). On Apple Silicon,
  `musllinux-x86_64` is not buildable under Docker Desktop Rosetta;
  `--zig` is the only local path and needs `zig` plus the matching
  `rustup` targets.
- `rustup target add wasm32-wasip1` (Go), and
  `x86_64-apple-darwin aarch64-apple-darwin` (Python universal2).
- `cargo-http-registry` on `PATH` for Rust (`cargo install cargo-http-registry`).

### Windows wheels

`win_amd64` and `win_arm64` need Windows runners. The local runner marks
them unavailable, passes `--allow-missing` for those families, and fails
the run unless `--accept-partial` is set. CI never passes `--allow-missing`.

The runner stamps version files, then restores them with `git checkout --`
in `finally` (including Ctrl-C). It never writes `~/.gitconfig`,
`.cargo/config.toml`, or `~/.gem/credentials` — Go fetch, cargo registry,
and `gem push` use process-scoped env.

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
export GOPRIVATE=github.com/solvapay/solvapay-go-rehearsal
export GOPROXY=direct
export GOSUMDB=off
go get github.com/solvapay/solvapay-go-rehearsal@v0.1.0-rehearsal.<run>
```

The rehearsal module repo is private; `go get` needs a GitHub token that
can read it.

### Rust

There is no durable preview crate. The rehearsal registry lives only for
the `publish-rust.yml` job. Use that job's install-smoke log as the
proof, or publish a production crate from a `solvapay-rust-v*` tag.
