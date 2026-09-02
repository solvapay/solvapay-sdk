# Release sandbox repo

`publish.yml` triggers on `push: branches: [main]`. The claim that an App-token
tag push starts the language workflows cannot be proven from a feature branch.

Stand up a **private** `solvapay/solvapay-sdk-release-sandbox` repository (or
a private fork) and install the same `solvapay-release-bot` GitHub App there.

## One-time setup

1. Create the private repo. Do not make it a production publish target.
2. Install the release-bot App on that repo (`RELEASE_APP_ID` / `RELEASE_APP_KEY`).
3. Copy sandbox-only secrets: TestPyPI trusted publisher, GitHub Packages,
   `SOLVAPAY_GO_DEPLOY_TOKEN` pointed at `solvapay/solvapay-go-rehearsal`,
   Verdaccio is local to the workflow and needs no secret.
4. Create the empty private `solvapay/solvapay-go-rehearsal` module repo.
5. Push this repo's `main` (or a mirror) to the sandbox `main`.

## What a sandbox run proves

1. Merge a PR to sandbox `main` → Version Packages PR.
2. Merge that PR → `changeset publish` (point npm at Verdaccio in the sandbox
   if you have rewritten `publish.yml`; otherwise skip the npm publish leg).
3. `workflow_dispatch` [push-rehearsal-tags.yml](../../.github/workflows/push-rehearsal-tags.yml)
   with the release-bot token.
4. The four `rehearsal/solvapay-<lang>-v*` workflows run and install-smoke
   against TestPyPI, GitHub Packages, `solvapay-go-rehearsal`, and the local
   Cargo registry.

Production `solvapay-<lang>-v*` tags are never created by that workflow.
