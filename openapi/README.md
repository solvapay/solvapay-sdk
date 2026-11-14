# SDK API spec

`sdk-v1.json` is the OpenAPI document for every API call a SolvaPay SDK makes
(`/v1/sdk/*`). It is written by the platform (`npm run openapi:sdk` in
solvapay/platform, checked there in CI) and copied here, so the SDKs build from
a fixed file instead of a running backend. `sdk-v1.source` records the platform
commit it came from.

Generated from it:

| What               | Command                                                       | Output                                   |
| ------------------ | ------------------------------------------------------------- | ---------------------------------------- |
| TypeScript types   | `pnpm --filter @solvapay/server generate:types`               | `packages/server/src/types/generated.ts` |
| Python HTTP client | `uv run --directory python python scripts/generate_client.py` | `python/src/solvapay/_generated/`        |

CI regenerates both and fails if the committed output differs.

## Updating

After an API change merges in the platform:

```bash
pnpm spec:sync ../platform
pnpm --filter @solvapay/server generate:types
uv run --directory python python scripts/generate_client.py
```

Ship the TypeScript and Python releases together when the spec changes.
