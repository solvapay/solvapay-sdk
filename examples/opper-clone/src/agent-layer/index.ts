// The SolvaPay agent layer: the one interface the clone's handler imports
// (prototype spec §2.1 rule 4). Identity is here (S2); metering is in
// `./metering` (S4); the spend policy, its pricing and the error bodies are in
// `./policy`, `./pricing` and `./errors` (S5); what the classifier gets from
// the prompt is in `./prompt` (SC).
import {
  looksLikeJwt,
  type AgentTokenResult,
  type VerifiedAgent,
} from './identity/verify-agent-token'

export { createPolicy, type Decided, type Policy, type PolicySettled } from './policy'
export { estimateCall, type Estimate, type ModelTier } from './pricing'
export { lastUserTurn, type PromptFacts } from './prompt'
export * as agentErrors from './errors'

export type Identification =
  | { kind: 'agent'; agent: VerifiedAgent }
  /** Not an agent token; the merchant's own auth decides. */
  | { kind: 'not_agent' }
  | { kind: 'rejected'; reason: 'expired' | 'invalid'; detail: string }

export interface AgentLayer {
  identify(presentedKey: string): Promise<Identification>
}

export function createAgentLayer(deps: {
  verifyAgentToken: (token: string) => Promise<AgentTokenResult>
}): AgentLayer {
  return {
    async identify(presentedKey) {
      if (!looksLikeJwt(presentedKey)) return { kind: 'not_agent' }
      const result = await deps.verifyAgentToken(presentedKey)
      return result.ok
        ? { kind: 'agent', agent: result.agent }
        : { kind: 'rejected', reason: result.reason, detail: result.detail }
    },
  }
}
