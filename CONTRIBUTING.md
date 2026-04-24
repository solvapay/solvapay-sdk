# Contributing

Thank you for your interest in contributing to SolvaPay SDK! This guide will help you get started.

Please also review our [Code of Conduct](./CODE_OF_CONDUCT.md) before contributing.

## Development Setup

### Prerequisites

- **Node.js** >= 18.17
- **pnpm** (package manager)
- **TypeScript** >= 5.0

### Getting Started

```bash
# Clone the repository
git clone https://github.com/solvapay/solvapay-sdk
cd solvapay-sdk

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test
```

### Working on a Specific Package

```bash
# Build a single package
pnpm -F @solvapay/server build

# Run tests for a single package
pnpm -F @solvapay/server test

# Dev mode (if defined for the package)
pnpm -F @solvapay/server dev
```

## Contributor docs

- [SDK architecture](./docs/contributing/architecture.md)
- [SDK testing](./docs/contributing/testing.md)
- [SDK error handling](./docs/contributing/error-handling.md)
- [SDK performance](./docs/contributing/performance.md)

### Running Examples

```bash
# Build packages first (examples depend on them)
pnpm build:packages

# Run an example
cd examples/express-basic
pnpm dev
```

## Code Style

- TypeScript strict mode; no `any` unless justified
- Prefer small, focused modules; keep runtime boundaries clean
- Match existing formatting; avoid unrelated churn

## Package Boundaries

Each package has specific constraints:

| Package | Constraints |
| --- | --- |
| `@solvapay/core` | No Node/browser globals (pure TypeScript, runtime-agnostic) |
| `@solvapay/server` | Node + Edge runtime support (automatic detection via export conditions) |
| `@solvapay/react` | Browser-only, no secrets, peer deps on React |
| `@solvapay/react-supabase` | Browser-only, peer deps on React and Supabase |
| `@solvapay/auth` | Server-side auth adapters, Edge-compatible |
| `@solvapay/next` | Next.js-specific, peer dep on Next.js |

## PR Checklist

Before submitting a pull request, ensure:

- [ ] Builds (`pnpm build`)
- [ ] Tests pass (`pnpm test`)
- [ ] Types OK (no dts errors)
- [ ] Web-standards runtime gate passes (`pnpm validate:fetch-runtime`) — required when touching `@solvapay/fetch` or `@solvapay/mcp-fetch`
- [ ] Docs updated when needed
- [ ] Documentation links valid (`pnpm docs:validate-links`)
- [ ] **Changeset committed** — run `pnpm changeset` and commit the generated `.changeset/*.md`. Skip only if the PR touches no published package.

## Commit and PR Hygiene

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(...)`, `fix(...)`, `docs:`, `refactor(...)`, etc.
- Small PRs with one changeset per user-visible change.
- Require code owner review per package.

## Releasing

The monorepo is driven by [**Changesets**](https://github.com/changesets/changesets) — packages move on independent semver tracks, and every release is a direct function of the `.changeset/*.md` files accumulated since the previous release.

### Writing a changeset

```bash
pnpm changeset
```

Pick the right bump level per affected package:

| Level     | When                                                                     |
| --------- | ------------------------------------------------------------------------ |
| **patch** | Bug fix, internal refactor, dep-only update — no public API change       |
| **minor** | New public API — additive and backwards-compatible                       |
| **major** | Removed/renamed API, changed signature, behaviour break — anything that  |
|           | would make an existing consumer's build / runtime regress after upgrade  |

The changeset body is a short markdown description that ends up verbatim in each affected package's `CHANGELOG.md`. Lead with **what changed for consumers**, not implementation detail.

### Branches & dist-tags

- **`dev`** — primary development branch. Every merge auto-publishes a
  preview snapshot to the `@preview` npm dist-tag
  (`@solvapay/core@0.0.0-preview-<shortsha>`).
- **`main`** — stable release branch. Every merge either (a) opens
  the **"Version Packages"** PR via
  [`changesets/action@v1`](https://github.com/changesets/action),
  which enumerates accumulated changesets and the versions they'll
  produce, or — when that PR merges — (b) publishes bumped packages
  to `@latest` and creates matching git tags.

See [`.github/workflows/README.md`](./.github/workflows/README.md) for the full workflow details.

### Pre-publish gates

Both workflows run the same gates — regressions here **block publish**:

1. `pnpm test` — full monorepo test suite.
2. `pnpm build:packages` — every publishable package builds to `dist/`.
3. `pnpm validate:fetch-runtime` — asserts `@solvapay/fetch` and
   `@solvapay/mcp-fetch` load cleanly in a bare Web-standards
   environment (no `node:`-prefixed imports, no leaked Node builtins).

Run them locally before opening the PR to shorten the feedback loop.

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: contact@solvapay.com
