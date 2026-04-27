---
'@solvapay/mcp-core': patch
---

`buildSolvaPayDescriptors` accepts a new optional `apiBaseUrl` that is
auto-appended to the resolved CSP's `resourceDomains` + `connectDomains`.
Integrators who used to hand-extend `csp` to get merchant branding
images rendering from their SolvaPay API origin can now drop the
override entirely — pass the same value they pass to
`createSolvaPay({ apiBaseUrl })` and the widget iframe's CSP envelope
includes it automatically.

`mergeCsp` grows the same optional second parameter. The origin is
normalised via `new URL(apiBaseUrl).origin`, so trailing slashes /
paths are stripped before insertion, and duplicates against
integrator-supplied overrides are deduped through the existing `Set`
merge.

When `apiBaseUrl` is omitted the behaviour is unchanged — the Stripe
baseline + integrator `csp` override still compose exactly as they did
in `0.2.0`.

See Phase 2a of `.cursor/plans/preview_iteration_+_promote_roadmap_88a4eaa0.plan.md`
for the original footgun this closes (merchant logos blocked by CSP in
the Goldberg smoke).
