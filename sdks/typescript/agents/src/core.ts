// The Rust core's agent decisions, through `@solvapay/server` (napi on Node,
// WASM on the edge). Every rule about tokens, prompts, the OAuth challenge and
// one paid call lives there, so each language SDK answers the same way.
import { isRecord } from './guards'

export {
  agentAuthChallenge,
  agentAuthorizeNext,
  agentAuthorizeRequest,
  agentCompleteBody,
  agentCredentialKind,
  agentKeyVerificationResult,
  agentPromptFacts,
  agentProtectedResource,
  agentSecretKeyEnvironment,
  parseAgentResponse,
  verifyAgentToken,
} from '@solvapay/server'

/**
 * A core helper's answer, or the error it returned thrown as one: a helper
 * answers `{ error, status, details }` for input it cannot read, and nothing
 * here goes ahead on that.
 */
export function unwrap<T>(answer: unknown): T {
  if (isRecord(answer) && typeof answer.error === 'string' && typeof answer.status === 'number') {
    throw new Error(typeof answer.details === 'string' ? answer.details : answer.error)
  }
  return answer as T
}
