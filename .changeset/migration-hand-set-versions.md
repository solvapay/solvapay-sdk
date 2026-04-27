---
---

**Hand-set-versions migration PR — intentionally empty changeset.**

This PR introduces Changesets to the monorepo, renames
`@solvapay/mcp` → `@solvapay/mcp-core`, renames
`@solvapay/mcp-sdk` → `@solvapay/mcp`, hard-renames
`@solvapay/supabase` → `@solvapay/fetch`, and scaffolds two new
packages (`@solvapay/mcp-express`, `@solvapay/mcp-fetch`).

Versions are set by hand in each affected `package.json` and the
inaugural release notes live in each package's `CHANGELOG.md`:

- `@solvapay/mcp-core@0.1.0`
- `@solvapay/mcp@0.1.0`
- `@solvapay/mcp-express@0.1.0`
- `@solvapay/mcp-fetch@0.1.0`
- `@solvapay/fetch@1.0.0` (renamed from `@solvapay/supabase@1.0.1` — code unchanged)
- `@solvapay/react@1.0.9` (peer-dep rename only)

Changesets' peer-dependency cascade would otherwise force `mcp-express`
/ `mcp-fetch` / `react` / `react-supabase` to `major` because the
framework-neutral base package (`mcp-core`) is at `0.x` and
`react-supabase`'s `workspace:^` peer on `react` [trips a semver-parser
bug](https://github.com/changesets/changesets/issues/1682) that
mis-identifies the range as "out of range". Neither is the intended
semantics for this reshuffle — the runtime-adapter surfaces are
production-tested, and the `react` change is a peer-dep contract
rename only.

All subsequent releases go through the normal Changesets flow —
preview snapshots on every push to `dev`, Version Packages PRs on
every push to `main`.
