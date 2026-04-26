---
---

**Hand-set-versions consolidation PR — intentionally empty changeset.**

This PR collapses `@solvapay/mcp-fetch` and `@solvapay/mcp-express`
into subpath exports of `@solvapay/mcp` (see the consolidation
release notes on `@solvapay/mcp@0.2.0`). Versions are set by hand in
each affected `package.json`:

- `@solvapay/mcp-core@0.2.0`
- `@solvapay/mcp@0.2.0`
- `@solvapay/server@1.0.8`
- `@solvapay/react@1.0.10`
- `@solvapay/react-supabase@1.0.8`

Changesets' default peer-dep cascade would otherwise force
`@solvapay/mcp` + `@solvapay/mcp-core` to `1.0.0` (because
`@solvapay/server` peer-dep gets a minor-or-higher bump, and any
minor-or-higher bump on a peer-dep target forces dependents to
major in Changesets' default cascade rule). For 0.x packages with
no external consumers, that jump to 1.x was not the intended
semantics. The breaking changes cataloged in the earlier
`text-only-paywall` + `hide-tools-by-audience` changesets are
shipped as a 0.x minor instead — appropriate for "still
iterating" surfaces.

**Housekeeping — npm registry cleanup (no external consumers
existed on the preview channel):**

- Unpublished the obsolete names entirely: `@solvapay/mcp-fetch`,
  `@solvapay/mcp-express`. Re-installs will 404 — update imports
  to the new subpaths (`@solvapay/mcp/fetch`,
  `@solvapay/mcp/express`).
- Unpublished the wrong-numbered preview snapshots:
  `@solvapay/mcp@1.0.0-preview-*`,
  `@solvapay/mcp-core@1.0.0-preview-*`,
  `@solvapay/react@2.0.0-preview-*`,
  `@solvapay/react-supabase@2.0.0-preview-*`,
  `@solvapay/server@1.1.0-preview-*`.
  Stable `0.1.0` / `1.0.7` remain on latest as before.

All subsequent releases resume the normal Changesets flow — with
the addition of the prevention tweak (experimental
`onlyUpdatePeerDependentsWhenOutOfRange` flag in
`.changeset/config.json` + `workspace:^` on the `@solvapay/server`
peer-dep in `mcp-core` and `mcp`) so the cascade no longer trips on
1.x → 1.x minors.
