## Description

<!-- Brief description of the changes in this PR. -->

## Type of Change

<!-- Mark the relevant option with an "x" -->

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)
- [ ] Performance improvement
- [ ] Test addition or update
- [ ] Build/CI changes

## Related Issues

Closes #
Related to #

## Changes Made

-
-
-

## Changeset

> [!IMPORTANT]
> Every user-visible change to a published package **MUST** include a
> changeset file under [`.changeset/`](../.changeset). Run
> `pnpm changeset` to generate one interactively. The file is the
> single source of truth for the next version bump + CHANGELOG entry.

- [ ] I ran `pnpm changeset` and committed the generated file
- [ ] Or — this PR touches no published packages (changelog N/A)
- [ ] My changeset selects the right bump level per package (patch / minor / major)

Pick the bump level honestly:

- **patch** — bug fix, internal refactor, dep-only update.
- **minor** — new public API, additive and backwards-compatible.
- **major** — removed/renamed API, changed signature, behaviour break.

See [CONTRIBUTING.md](../CONTRIBUTING.md#releasing) for the full release workflow.

## Testing

- [ ] `pnpm test` — unit tests pass
- [ ] `pnpm build` — full monorepo build passes
- [ ] `pnpm tsx scripts/validate-fetch-runtime.ts` — Web-standards runtime gate passes (required if you touched `@solvapay/fetch` or `@solvapay/mcp-fetch`)
- [ ] Manual testing completed
- [ ] Tested in relevant environments (Node / Deno / Cloudflare Workers / Bun / Next edge / …)

## Checklist

- [ ] My code follows the project's style guidelines (`pnpm lint` / `pnpm format`)
- [ ] I have performed a self-review of my code
- [ ] I have commented my code in hard-to-understand areas (not narration comments)
- [ ] I have updated the documentation (`README.md`, `docs/`, package READMEs) accordingly
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes

## Screenshots / Examples

<!-- If applicable, add screenshots or code examples. -->

## Additional Notes

<!-- Any additional information that reviewers should know. -->
