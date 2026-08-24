# Dependency deprecations (contributors)

This page records npm deprecations that still appear in the lockfile after
version bumps that *can* clear a warning. Do not add pnpm overrides to paper
over these — an override would hide the real pin or peer mismatch.

## Cleared by version bumps

These used to fire on every install or common script and are gone after the
current floors:

- `tsx` `^4.23.12` — Node `[DEP0205]` (`module.register()`)
- `tailwindcss` / `@tailwindcss/postcss` `^4.3.3` — the same `[DEP0205]` from
  `@tailwindcss/node`
- `vite-plugin-singlefile` `^2.3.3` — Rolldown `inlineDynamicImports` warning
- `@commitlint/cli` and `@commitlint/config-conventional` `^21.2.2`,
  `@commitlint/types` `^21.2.0` (latest types release; dropped the deprecated
  `git-raw-commits` subtree)
- `@ungap/structured-clone@1.3.3` — lockfile refresh within `^1.0.0` (CWE-502;
  1.3.0 was deprecated)

## Blocked upstream

No published version of these packages is non-deprecated, or a parent hard-pins
an exact deprecated version.

### `node-domexception`

Every published version (`1.0.0` through `2.0.2`) is marked deprecated on npm.
It reaches the tree through `fetch-blob` / `formdata-polyfill` under
`node-fetch@3.3.2` (`google-auth-library`), and through `formdata-node@4.4.1`
under `openai@4.104.0` and `cloudflare@4.5.0`. Those are example-app
devDependencies. Leave it until those parents drop the polyfill.

### `glob@9.3.5`

`@node-minify/core@8.0.6` hard-pins `"glob": "9.3.5"` (not a range). The chain
is `checkout-demo` → `@opennextjs/cloudflare` → `@opennextjs/aws` →
`@node-minify/core`. An override here would be masking a transitive pin.

## Deferred migrations

These are real work, not a patch bump. Do not fold them into a lockfile
cleanup.

### ESLint 10

`eslint@9.x` is registry-deprecated as a whole major line ("no longer
supported"). `typescript-eslint`, `eslint-plugin-react-hooks`, and
`eslint-config-prettier` already declare `^10.0.0` peers, but
`eslint-plugin-react@7.37.5` still caps at `^9.7` with no v10 release. That
plugin is only loaded through `eslint.config.react.mjs` for `@solvapay/react`
and `@solvapay/react-supabase`. Wait for upstream before bumping.

Legacy `.eslintrc.json`, `.eslintrc.react.json`, and `.eslintignore` still sit
next to the flat configs. ESLint 9 ignores eslintrc when `eslint.config.mjs` is
present; ESLint 10 dropped `.eslintignore`. The ignore list is already in the
`ignores` block of `eslint.config.mjs`. Deleting the legacy files is safe
cleanup when the ESLint 10 ticket starts.

### `packageManager` / pnpm 10+

Homebrew pnpm 11 prints `[WARN] The "pnpm" field in package.json is no longer
read by pnpm` before delegating to `packageManager: pnpm@9.6.0`. Under 9.6.0
the override **is** active (`overrides: next: 16.2.7` in `pnpm-lock.yaml`).

The warning becomes a real breakage the moment `packageManager` moves to pnpm
10 or higher. In **the same commit** as that bump:

1. Move `pnpm.overrides` from `package.json` into `pnpm-workspace.yaml` as
   `overrides:`.
2. Move `link-workspace-packages=true` from `.npmrc` into
   `pnpm-workspace.yaml` as `linkWorkspacePackages: true`.

If those two moves are skipped, the `next` pin silently stops applying.
