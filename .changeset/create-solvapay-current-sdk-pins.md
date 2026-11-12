---
'create-solvapay': minor
---

Scaffolds no longer start, or stay, behind the SDK.

- If the registry lookup for the SolvaPay packages fails, in any language, the scaffold stops with an error naming each package and why, instead of quietly pinning fallback versions. Pass `--offline` to pin the versions this release ships with.
- A generated project's `npm run deploy` stops when an installed `@solvapay/*` package is behind npm and prints the exact upgrade command. `--allow-outdated` deploys those versions on purpose.
- Generated projects ship `.github/dependabot.yml`, which opens one weekly pull request moving all `@solvapay/*` packages to npm's latest together.
