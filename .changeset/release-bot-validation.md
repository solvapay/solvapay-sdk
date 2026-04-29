---
'@solvapay/core': patch
---

Release-bot validation bump. The publish workflow ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)) now mints a 60-minute installation token from the `solvapay-release-bot` GitHub App via `actions/create-github-app-token@v2` so `changesets/action` can open the "Version Packages" PR without tripping the org's `can_approve_pull_request_reviews: false` policy on the default `GITHUB_TOKEN`. This patch exists to drive a real end-to-end run through the new credential path; no code changes ship with it.
