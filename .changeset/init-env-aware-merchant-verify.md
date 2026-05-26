---
'create-solvapay': minor
'@solvapay/init': minor
'solvapay': patch
---

Env-aware merchant verify in `solvapay init` + new `--skip-install` /
`--skip-init` flags on `npm create solvapay`.

`solvapay init` now hard-fails on merchant lookup **before** writing
`.env`, adding `.env` to `.gitignore`, or installing the SDK — so a
failing probe no longer leaves a half-scaffolded project behind. The
existing "secret key verified" line is also relabelled to "secret key
authenticates" so it stops printing right before a `not_found`.

`@solvapay/init` parses the backend's new structured 4xx bodies:

- `404 provider_not_found_in_environment` → `VerifyMerchantResult` now
  carries `environment` and `providerExistsInSandbox`. When the user's
  sandbox account exists but live isn't promoted, the CLI now points
  them at "switch to live in the Console" instead of generic
  onboarding.
- `403 key_env_mismatch` → new `env_mismatch` discriminant on
  `VerifyMerchantResult`, surfaced as a dedicated error with both the
  key env and the provider env. Previously this would have fallen
  through to a generic `error`.

The `not_found` message now also names the environment (falling back to
the env returned by the cli-init exchange when the backend body omits
it), so the recovery path is unambiguous.

`create-solvapay` adds two new flags for re-runnable / scripted
scaffolds:

- `--skip-install` — skip the post-scaffold `npm install`. The "next
  steps" footer reminds the user to install manually.
- `--skip-init` — skip the post-scaffold `solvapay init` step (no
  browser OAuth). The footer adds `npx solvapay init` to the next
  steps so the user wires up auth + product when they're ready.
