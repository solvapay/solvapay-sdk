---
'@solvapay/agents': minor
'@solvapay/server': minor
---

Agent payments run on the Rust core, so every language SDK answers the same way. Token verification, agent key answers, prompt facts, the OAuth protected-resource document and 401 challenge, the authorize body, what to do with each authorize answer, and the complete body are core helpers (`verifyAgentToken`, `agentKeyVerificationResult`, `agentPromptFacts`, `agentProtectedResource`, `agentAuthChallenge`, `agentAuthorizeRequest`, `agentAuthorizeNext`, `agentCompleteBody`, `parseAgentResponse`, `agentCredentialKind`, `agentSecretKeyEnvironment`), exported from `@solvapay/server`. The server client gains `verifyAgentKey`, `authorizeAgentCall`, `completeAgentCall` and `reportAgentUsage`.

Breaking for `@solvapay/agents` preview users: `createAgentTokenVerifier` takes `jwks` (the issuer's key set, or a loader) instead of a jose `keys` resolver. Use `remoteAgentJwks(\`${issuer}/jwks.json\`)` in production; it keeps the key set five minutes and fetches again once when a token is signed by a key it has not seen. A key set that cannot be read throws, and no token is accepted.
