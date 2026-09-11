Smoke-test inputs for `smoke.test.ts`. Refresh with `node scripts/refresh-smoke-fixtures.mjs`. Do not edit by hand.

The three OpenAPI specs are pinned copies of:

- `petstore-v2.spec.json` — https://petstore.swagger.io/v2/swagger.json (Swagger 2.0)
- `petstore-v3.spec.json` — https://petstore3.swagger.io/api/v3/openapi.json (OpenAPI 3.0.4)
- `pokeapi.spec.yml` — https://raw.githubusercontent.com/PokeAPI/pokeapi/master/openapi.yml (OpenAPI 3.1)

When an upstream changes operation count / security shape, the smoke test fails. Re-run the refresh script, then either bump the assertions or investigate why the upstream regressed.
