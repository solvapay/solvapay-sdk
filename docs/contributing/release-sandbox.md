# Release sandbox repo

`publish.yml` triggers on `push: branches: [main]`, so the merge-to-`main`
production path cannot be proven from a feature branch. A private sandbox repo
is the only way to rehearse it end to end.

For everything else — channels, registries, gates, credentials — see
[release-and-publishing.md](./release-and-publishing.md).

## One-time setup

1. Create a **private** `solvapay/solvapay-sdk-release-sandbox` repository (or a
   private fork). Do not make it a production publish target.
2. Install the `solvapay-release-bot` GitHub App on it and add
   `RELEASE_APP_ID` / `RELEASE_APP_KEY`.
3. Copy sandbox-only credentials: a TestPyPI trusted publisher pointing at the
   sandbox repo, and GitHub Packages for Ruby. Verdaccio is local to the
   workflow and needs no secret.
4. Push this repo's `main` (or a mirror) to the sandbox `main`.

## What a sandbox run proves

1. Merge a PR to sandbox `main` → the Version Packages PR opens under the App
   identity, which is the part org policy blocks for `GITHUB_TOKEN`.
2. Merge that PR → `changeset publish` runs. Point npm at Verdaccio in the
   sandbox if you have rewritten `publish.yml`; otherwise skip the npm publish
   leg.
3. Dispatch [`push-rehearsal-tags.yml`](../../.github/workflows/push-rehearsal-tags.yml)
   with the release-bot token — this is the claim that a tag pushed by an App
   token actually fires the language workflows.
4. The four `rehearsal/solvapay-<lang>-v*` workflows run and install-smoke
   against TestPyPI, GitHub Packages, `sdks/go/v*-rehearsal.<run>` on the sandbox
   repo, and the local Cargo registry.

Production `solvapay-<lang>-v*` tags are never created by that workflow.
