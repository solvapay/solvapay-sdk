# Contributing

## Local development
- Install: `pnpm i`
- Build all: `pnpm -w build`
- Test all: `pnpm -w test`
- Dev (per package): `pnpm -F @solvapay/<pkg> dev` if defined
- **Hot reloading**: See [`docs/HOT_RELOADING_SETUP.md`](./docs/HOT_RELOADING_SETUP.md) for setting up automatic rebuilds and hot reloading in examples

## Code style
- TypeScript strict mode; no `any` unless justified
- Prefer small, focused modules; keep runtime boundaries clean
- Match existing formatting; avoid unrelated churn

## Package boundaries
- `core`: no Node/browser globals (pure TypeScript)
- `server`: Node + Edge runtime support (automatic detection)
- `react`: React components (browser-only, no secrets)

## PR checklist
- [ ] Builds (`pnpm -w build`)
- [ ] Tests pass (`pnpm -w test`)
- [ ] Types OK (no dts errors)
- [ ] Docs updated when needed

## Commit & PR Hygiene

- Prefer Conventional Commits: `feat(...)`, `fix(...)`, etc.
- Small PRs with one changeset per user-visible change.
- Require code owner review per package.

## Publishing Strategy

See [`docs/publishing.md`](./docs/publishing.md) for:
- Branch and versioning strategy (`dev` → `main`)
- Automated publishing workflow
- Conventional commits and changelog generation
- Troubleshooting and manual publishing

