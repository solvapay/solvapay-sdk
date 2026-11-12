// The Rust core behind this package. Every decision here (how an answer is
// read, who a token names, what a call does next, which status a refusal
// gets) is made in `solvapay-core` and shared with the Python, Ruby, Go and
// Rust SDKs. Loading `@solvapay/server` installs the native binding the
// helpers dispatch to.
import '@solvapay/server'

export {
  agentAmountString,
  agentCallStep,
  agentCanonicalResource,
  agentChallengeHeaders,
  agentCompleteBody,
  agentCredentialKind,
  agentFromClaims,
  agentGateResult,
  agentKeyResult,
  agentMcpRouteStep,
  agentPromptFacts,
  agentProtectedResource,
  agentRefusalStatus,
  agentRefusalToolResult,
  agentSecretKeyEnvironment,
  isAgentKey,
  looksLikeJwt,
  parseAgentResponse,
} from '@solvapay/core'

/** A core answer that is either a value or the sentence for why there is none. */
type Checked = { ok: true; value: unknown } | { ok: false; error: string }

/** The value of a checked core answer; its failure is thrown, as this package always did. */
export function unwrap<T>(result: unknown): T {
  const checked = result as Checked
  if (!checked.ok) throw new Error(checked.error)
  return checked.value as T
}
