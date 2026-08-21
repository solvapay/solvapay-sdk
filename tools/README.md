# Tools

Repo-root TypeScript tooling for the SolvaPay SDK monorepo, split by job:

| Bucket | Path | Owns |
| --- | --- | --- |
| Shared | `tools/shared/` | Layout loaders (`paths.ts`, `repo-paths.ts`) and the contract-manifest Zod schema used by more than one bucket |
| Codegen | `tools/codegen/` | `pnpm gen` / `gen:scaffold` / `gen:bindings` / `manifest:*` / OpenAPI snapshot |
| Conformance | `tools/conformance/` | Fixture harness, parity, delegation, shadow, webhook-edge replay |
| Repo | `tools/repo/` | Required-checks, release dry-run, typecheck, doc-link and fetch-runtime gates |

`tools/` holds both TypeScript gates and unpublished Rust binaries: `dto-gen`
under `tools/codegen/`, and `fixture-runner` / `live-contract` / `shadow-invoker`
under `tools/conformance/`. The `repo-paths` crate lives next to the TS layout
loader in `tools/shared/repo-paths/`.

Versioning + publishing live under [Changesets](https://github.com/changesets/changesets) — run `pnpm changeset`, merge the generated "Version Packages" PR, and the GitHub Actions workflows under [`.github/workflows/`](../.github/workflows) handle the rest.

## Codegen

| Command | Script |
| --- | --- |
| `pnpm gen` / `pnpm gen:check` | `tools/codegen/gen.ts` |
| `pnpm gen:scaffold` / `pnpm gen:bindings` | `tools/codegen/gen-scaffold.ts`, `gen-bindings.ts` |
| `pnpm snapshot:openapi` | `tools/codegen/snapshot-openapi.ts` |
| `pnpm manifest:validate` / `manifest:check` | `tools/codegen/manifest.ts` |

See [`docs/contributing/sdk-codegen.md`](../docs/contributing/sdk-codegen.md).

## Conformance

| Command | Script |
| --- | --- |
| `pnpm test:contract` | Vitest over `tools/` (excludes shadow selftest) |
| `pnpm parity:check` | `tools/conformance/parity-check.ts` |
| `pnpm delegation:check` | `tools/conformance/check-delegation.ts` |
| `pnpm shadow:run` / `pnpm shadow:selftest` | `tools/conformance/shadow/` |

## Repo gates

| Command | Script |
| --- | --- |
| `pnpm docs:validate-links` | `tools/repo/validate-doc-links.ts` |
| `pnpm validate:fetch-runtime` | `tools/repo/validate-fetch-runtime.ts` |
| `pnpm checks:required` | `tools/repo/check-required-checks.ts` |
| `pnpm checks:release-dryrun` / `pnpm release:dryrun` | `tools/repo/check-release-dryrun.ts`, `release-dryrun.ts` |
| `pnpm deps:check` | `tools/repo/check-dependency-health.ts` |
| `pnpm loc` | `tools/repo/count-loc.ts` (`--include-examples`, `--include-tools`, `--include-docs`) |
| `pnpm typecheck` | `tools/repo/typecheck-packages.ts` |

`tools/repo/apply-branch-protection.mjs` prints the `gh api` required-status-checks payload from `contract/required-checks.yaml`. `--apply` is maintainer-opt-in and is never run from CI.

`tools/repo/verify-npm-publishes.mjs` polls the npm registry after a publish. Usage: `node tools/repo/verify-npm-publishes.mjs --packages='[…]'`

`tools/repo/setup-pre-commit-hook.sh` sets up the doc-link pre-commit hook. `create-missing-tag.sh` is legacy, kept for creating git tags manually (e.g. historical releases that predate changesets).
