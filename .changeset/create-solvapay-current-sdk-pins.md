---
'create-solvapay': minor
---

Scaffolds no longer start behind the SDK. If the npm registry lookup for `@solvapay/*` fails, the scaffold now stops with an error naming each package and why, instead of quietly pinning old fallback versions. Pass `--offline` to pin the versions this release ships with on purpose. The template's `@solvapay/*` pins are exact and current (`@solvapay/mcp` 0.5.0, `@solvapay/mcp-core` 0.5.0, `@solvapay/server` 2.11.0, `@solvapay/react` 2.7.1), and `pnpm --filter create-solvapay sync:sdk-pins` keeps them on npm's `latest` after each release.
