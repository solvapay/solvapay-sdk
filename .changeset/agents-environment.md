---
'@solvapay/agents': minor
---

An agent says which environment it spends in: `VerifiedAgent.environment` is `sandbox` or `live`, read from the agent token's `env` claim or the agent key verification. Pass the merchant's environment to the verifier (`secretKeyEnvironment`) and an agent from the other environment is refused with `environment_mismatch`.
