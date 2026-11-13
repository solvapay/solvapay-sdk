# AGENTS.md — openapi/

`sdk-v1.json` is the SDK's API spec, copied from the platform. Every language
generates its client from it.

- **Never edit `sdk-v1.json` or `sdk-v1.source` by hand.** Change the platform,
  then run `pnpm spec:sync` here. CI fails when the copy drifts.
- After a sync, regenerate each client (`generate:types` for TypeScript,
  `python/scripts/generate_client.py` for Python) in follow-up PRs per language.
- Owned by the TypeScript SDK, like `conformance/`: a spec change and a language
  folder in the same PR fail the "Contract boundary" check.
