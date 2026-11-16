# @solvapay/agents

## 0.1.1

### Patch Changes

- Updated dependencies [5040df6]
- Updated dependencies [b03ef76]
- Updated dependencies [2bf1da2]
  - solvapay@1.5.1
  - @solvapay/server@2.12.1

## 0.1.0

### Minor Changes

- 221d12f: An agent says which environment it spends in: `VerifiedAgent.environment` is `sandbox` or `live`, read from the agent token's `env` claim or the agent key verification. Pass the merchant's environment to the verifier (`secretKeyEnvironment`) and an agent from the other environment is refused with `environment_mismatch`. Live is an environment the API knows, but live agent payments aren't open yet: SolvaPay refuses live agents for now, so build and test in sandbox.
- fa3f586: `@solvapay/agents` is published, starting at 0.1.0: verify agent tokens, authorize and complete each paid call and report usage, with adapters for MCP servers (`@solvapay/agents/mcp`) and HTTP APIs (`@solvapay/agents/http`), plus `@solvapay/agents/testing`. It ships built ESM with type declarations. Agent payments are a preview: SolvaPay turns them on per merchant, and until then calls are refused with `feature_not_enabled`. Live agent payments aren't open yet, so build and test with a sandbox key.

### Patch Changes

- 386dd2c: `createAgentMcpRoute` registers `freeTools` for a signed-in agent too, as documented ("signed in or not"). They were only registered for a host that had not signed in, so an agent lost the free tools once it connected (`Tool … not found`).
- 4569d7f: Fixes found by the conformance coverage of the agents package:
  - The prompt excerpt never ends up starting with half of a character: when the 1,500-unit cut goes through an emoji, its lone half is dropped.
  - A cost of 1e21 or more is sent as plain digits, not `1e+21`.
  - A resource at the origin gets the metadata path `/.well-known/oauth-protected-resource`, without a trailing slash.
  - A numeric `jti` comes back as a string token id.
  - In a batch from a host that has not signed in, the challenge carries the id of the paid call that needs sign-in, not of the first call.
  - `refusalStatus` throws a `SolvaPayError` with code `unknown_refusal_reason` for a reason it doesn't know.

- Updated dependencies [ec5b929]
- Updated dependencies [55885b2]
- Updated dependencies [ac65287]
- Updated dependencies [b3feb5d]
- Updated dependencies [ec77a0e]
- Updated dependencies [a611caa]
- Updated dependencies [469aa57]
- Updated dependencies [57026b6]
- Updated dependencies [a2e2f9f]
- Updated dependencies [98a315b]
- Updated dependencies [0874abe]
- Updated dependencies [74dbdb7]
- Updated dependencies [f2b03e5]
- Updated dependencies [5960ef4]
- Updated dependencies [d4e90a8]
- Updated dependencies [80b8b65]
- Updated dependencies [5aa5637]
- Updated dependencies [261a5a7]
- Updated dependencies [267440c]
  - solvapay@1.5.0
  - @solvapay/server@2.12.0
  - @solvapay/core@1.9.0
