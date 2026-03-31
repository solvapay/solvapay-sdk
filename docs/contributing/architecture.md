# SDK architecture (contributors)

This page is for contributors working inside the `solvapay-sdk` monorepo.

## Monorepo layout

```text
solvapay-sdk/
├─ examples/
├─ packages/
│  ├─ core/
│  ├─ server/
│  ├─ react/
│  ├─ react-supabase/
│  ├─ auth/
│  ├─ next/
│  ├─ demo-services/   # private
│  ├─ test-utils/      # private
│  └─ tsconfig/        # private
├─ docs/
├─ pnpm-workspace.yaml
├─ turbo.json
└─ package.json
```

## Package boundaries

- `@solvapay/core`: shared types, schemas, and runtime-agnostic utilities
- `@solvapay/server`: server runtime SDK, paywall checks, usage, webhooks
- `@solvapay/react`: provider, hooks, and checkout UI
- `@solvapay/react-supabase`: Supabase adapter for `@solvapay/react`
- `@solvapay/auth`: auth adapters and request helpers
- `@solvapay/next`: Next.js wrappers around common server flows

## Runtime strategy

`@solvapay/server` uses export conditions so consumers can keep one import style while
loading the right runtime implementation:

- Node runtimes use Node crypto
- Edge/worker runtimes use Web Crypto (`crypto.subtle`)

## Design principles

- Keep secrets in server code only
- Keep package APIs focused and explicit
- Avoid cross-package leaks of runtime-specific behavior
- Prefer shared types in `@solvapay/core` over duplicated interfaces

## Build and release model

- `turbo` orchestrates workspace tasks
- packages are built with `tsup` (ESM, CJS, types as needed)
- branch and release flow is documented in `docs/publishing.mdx`

## Where to read next

- `CONTRIBUTING.md` for setup and pull request workflow
- `docs/contributing/testing.md` for test strategy
- package-level `README.md` files for package-specific constraints
