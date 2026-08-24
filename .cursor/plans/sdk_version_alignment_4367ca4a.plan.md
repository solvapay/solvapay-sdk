# SDK version alignment

Put the ten runtime packages on one version line at **2.2.0**, in a dedicated release immediately after the August one. This makes `@solvapay/server@2.0.0` read as the first release of the family's 2.x line rather than an outlier — the correction, achieved forward.

## Background

`@solvapay/server` went to 2.0.0 on 2026-07-17 while every other package stayed on `1.x` or `0.x`. That major was backed by an explicit `major` changeset (the auto-recharge `maxRecharges` to `maxMonthlySpendMajor` rename, DEV-635) and a public migration note in the July 17 docs changelog, so it was not a tooling accident. But shipping a lone `2.x` runtime package is not the versioning story we want, and there are no live customers to protect, so the family should be brought onto one line.

Note there was a separate, genuine cascade incident — a `patch` to `@solvapay/mcp-core` plus a `minor` to `@solvapay/auth` once pushed `react`, `server`, and `react-supabase` all to 2.0.0 with no breaking change anywhere. That one was caught before publish (npm `latest` for those is 1.6.0 / 1.0.10) and is what `.cursor/rules/monorepo-versioning.mdc` exists to prevent. It is not the published 2.0.0.

## There is no removal path

Confirmed, not assumed. `@solvapay/server@2.0.0` is past npm's 72-hour self-service unpublish window. It also fails npm's narrow post-window criteria on two counts: package-level downloads are 579/week against a 300 threshold, and another registry package depends on it:

```
$ npm view @solvapay/next@1.3.0 dependencies
{ "@solvapay/auth": "1.1.0", "@solvapay/core": "1.2.0", "@solvapay/server": "2.0.0" }
```

That exact pin comes from `workspace:*` in `dependencies`. Publishing a corrected `next@1.3.1` does not help — `1.3.0` stays in the registry holding the dependency. `npm deprecate` removes nothing and would warn `@solvapay/next` installers about a transitive dep they cannot change.

Publishing a `1.x` successor instead is worse: the monthly spend cap has to exist in whatever ships next, so a `server@1.6.0` would carry the same `maxRecharges` removal and every consumer on `^1.3.0` would auto-upgrade straight into a breaking rename with no signal. That is exactly the case the repo's own bump table classifies as major.

## Baseline after the August release ships

The August release goes out on independent tracks first. Expected state going into this work:

- `@solvapay/server` 2.1.0, `@solvapay/react` 1.7.0, `@solvapay/core` 1.3.0, `solvapay` 1.3.0, `@solvapay/next` 1.3.1, `@solvapay/init` 0.4.0
- `@solvapay/auth` 1.1.0 and `@solvapay/react-supabase` 1.0.10, both untouched — `workspace:^` keeps `^1.6.0` in range for react 1.7.0, so `onlyUpdatePeerDependentsWhenOutOfRange` does not bump react-supabase
- `@solvapay/mcp` 0.3.0, `@solvapay/mcp-core` 0.3.0
- Staying independent: `create-solvapay` 0.6.0

## The alignment release lands everything on 2.2.0

Verified against the changesets implementation in `@changesets/assemble-release-plan@6.0.10` rather than inferred:

```js
for (let fixedPackages of config.fixed) {
  let releasingFixedPackages = [...releases.values()].filter(release => fixedPackages.includes(release.name) && release.type !== "none");
  let highestReleaseType = getHighestReleaseType(releasingFixedPackages);
  let highestVersion = getCurrentHighestVersion(fixedPackages, packagesByName);
```

Every group member takes the group's current highest version as its `oldVersion` and the highest release type in the release. It also synthesises a release for members that have no changeset, so all ten publish together. With `server` 2.1.0 as the highest and a single **minor** changeset describing the alignment, all ten land on **2.2.0**. No hand-edited versions, no 3.0.0.

Group: `@solvapay/server`, `@solvapay/core`, `@solvapay/react`, `@solvapay/react-supabase`, `@solvapay/next`, `@solvapay/auth`, `solvapay`, `@solvapay/mcp`, `@solvapay/mcp-core`, `@solvapay/init`.

`@solvapay/mcp` and `@solvapay/mcp-core` go 0.3.0 to 2.2.0, and `@solvapay/init` goes 0.4.0 to 2.2.0, all skipping 1.x entirely. That is legitimate and desirable — it ends the `0.x` "no stability contract" semantics that no longer match packages which are documented, pinned by the `create-solvapay` templates, and in production. Call the jump out explicitly in the changelog so it does not read as a mistake.

## Why `@solvapay/init` is in the group

Originally scoped out, then moved in on evidence: `@solvapay/init` depends on `@solvapay/core` as `workspace:*` — an exact pin on an in-group package. Combined with `"updateInternalDependencies": "patch"` in `.changeset/config.json`, every `core` release puts that pin out of range and forces an `init` release. And `solvapay` (in-group) depends on `init` as `workspace:^`, so an `init` bump would in turn drag the whole group.

So `init` already releases in lockstep with the group through `core`; leaving it out would only mean it carries a different number while shipping on the same cadence. Including it removes that churn entirely.

Second-order benefit: `create-solvapay` stays independent and depends on `init` as `workspace:^`. Today `init` is `0.x`, so every `init` minor puts that caret out of range and bumps the scaffolder. After alignment the caret publishes as `^2.2.0` and ordinary group minors stay in range, so `create-solvapay` gets *more* stable, not less.

## The win: hand-maintained peer ranges become unnecessary

Today `@solvapay/mcp` and `@solvapay/mcp-core` carry explicit multi-major peer ranges on `@solvapay/server` (`^1.4.0 || ^2.0.0`), and `@solvapay/react` carries `^0.2.8 || ^0.3.0` on `@solvapay/mcp-core`. These exist only to dodge false-major cascades, and `.cursor/rules/monorepo-versioning.mdc` devotes a whole "narrow exception" section (lines 60-84) to justifying them.

Once all ten move together, every in-group peer can go back to `workspace:^`, which publishes `^2.2.0` and stays in range because the group never diverges. The cascade problem disappears structurally and that rule section can be retired for in-group packages. It also clears a dead range: stable `server` never published 1.4.0 or 1.5.0 (previews only), so the `^1.4.0` half could never match anything.

## Sequence

1. Ship the August release on independent tracks.
2. Rewrite `docs/publishing.mdx`. It currently claims fixed versioning on a shared line, auto patch bumps on push to `main`, versions tracked by git tag only, and a `pnpm version:sync` command that no longer exists — none of which matches `.github/workflows/publish.yml`. The alignment makes its *original* claim true, but every other detail still needs correcting. Do this regardless of the rest; it is the artifact most likely to make someone "fix" a version by hand.
3. Add the ten-package `fixed` array to `.changeset/config.json`.
4. Revert in-group peer ranges to `workspace:^` in `packages/mcp/package.json`, `packages/mcp-core/package.json`, and `packages/react/package.json`; add a patch changeset per edited package (a peer-range change is consumer-facing) and run `pnpm install` to refresh the lockfile.
5. Update `CONTRIBUTING.md` line 102 ("packages move on independent semver tracks") and `.cursor/rules/monorepo-versioning.mdc` — both the "would release NO packages as a major" verification step and the now-obsolete narrow-exception section. Without this, the next engineer or agent reads the group bump in `changeset status` as a cascade bug and goes hunting.
6. Dry-run `pnpm changeset:version` on a scratch branch. Confirm all ten read 2.2.0 and the regenerated `CHANGELOG.md` files look right, then discard the branch. Never hand-edit a `version` field; the release workflow runs `scripts/assert-stable-workspace-versions.mjs`.
7. Publish, then add a docs changelog entry with an old-to-new list for all ten, stating plainly that no public API changed and that the numbers moved to put the family on one line.

## Acceptance criteria

- [ ] `docs/publishing.mdx` describes the actual changesets flow, with no references to `pnpm version:sync`, git-tag-only versions, or auto patch bumps on push to `main`.
- [ ] `.changeset/config.json` contains the ten-package `fixed` group.
- [ ] No in-group package carries a hand-written multi-major peer range; all in-group peers are `workspace:^`.
- [ ] `CONTRIBUTING.md` and `.cursor/rules/monorepo-versioning.mdc` describe fixed-group behaviour and no longer instruct readers to treat any major as a cascade bug.
- [ ] A dry run of `pnpm changeset:version` puts all ten packages on the same version.
- [ ] The alignment release publishes all ten, and a docs changelog entry maps old to new for each and states that no public API changed.

## Risks, accepted knowingly

There are no live customers on the platform, so these cost almost nothing today. They are permanent characteristics of the setup rather than one-time costs.

- All ten publish on every release, including untouched packages.
- Packages with no change get version jumps, some across major boundaries (`react` 1.7.0 to 2.2.0, `auth` 1.1.0 to 2.2.0). Caret-pinned consumers silently stop receiving updates until they widen — the changelog map is the only mitigation.
- `2.0.0` stays in the registry forever, so `npm view @solvapay/server versions` will always show the 1.3.0-to-2.0.0 gap.
- This is the cheapest moment the change will ever be; the cost grows with every integrator added.
