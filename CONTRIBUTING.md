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
- [ ] Docs updated when needed
- [ ] Documentation links valid (`pnpm docs:validate-links`)

## Commit and PR Hygiene

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat(...)`, `fix(...)`, `docs:`, `refactor(...)`, etc.
- Small PRs with one changeset per user-visible change
- Require code owner review per package

See [`docs/publishing.md`](./docs/publishing.md) for the full publishing and branching strategy.

## Publishing Strategy

- **`dev`** branch -- main development branch for daily work
- **`main`** branch -- production branch that triggers automated npm publishing
- All publishing is handled via GitHub Actions

See [`docs/publishing.md`](./docs/publishing.md) for complete details on versioning, publishing, and preview releases.

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/solvapay/solvapay-sdk/issues)
- **Email**: contact@solvapay.com
