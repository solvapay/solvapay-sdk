---
'@solvapay/agents': minor
---

An agent says which environment it spends in: `VerifiedAgent.environment` is `sandbox` or `live`, read from the agent token's `env` claim or the agent key verification. Pass the merchant's environment to the verifier (`secretKeyEnvironment`) and an agent from the other environment is refused with `environment_mismatch`. Live is an environment the API knows, but live agent payments aren't open yet: SolvaPay refuses live agents for now, so build and test in sandbox.
