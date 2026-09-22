---
'create-solvapay': minor
---

Independent scaffolder updates, including language templates and the `@solvapay/react` pin on the 2.x line.

OpenAPI 3.1 patch versions parse during describe and scaffold, and the generated Worker deploy script uses the Wrangler config for the account you logged into. A first deploy uploads secrets after the Worker exists, and auth is checked before the widget build.
