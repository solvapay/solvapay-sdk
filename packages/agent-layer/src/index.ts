/**
 * `@solvapay/agent-layer` — what a merchant needs to be paid by SolvaPay
 * agents, as a thin client (DEV-1126): verify the agent token, ask SolvaPay to
 * authorize each call, complete it at the cost the upstream reported, and
 * report usage for reconciliation. The spend policy, the classifier, the
 * approval hold, the balance and the settle rules all run in SolvaPay.
 *
 * Private for now; it becomes the preview package once the lab runs on it.
 * Protocol-neutral: no route, no Anthropic or MCP types.
 */
export {
  AGENT_TOKEN_EXCERPT_CLAIM,
  createAgentLayer,
  createAgentTokenVerifier,
  looksLikeJwt,
  type AgentLayer,
  type AgentTokenResult,
  type AgentTokenVerifierOptions,
  type Identification,
  type VerifiedAgent,
} from './identity'
export {
  AgentApiError,
  AUTHORIZE_WAIT_MAX_SECONDS,
  createSolvaPayAgentClient,
  parseAuthorizeResponse,
  parseCompleteResponse,
  parseUsageReportResponse,
  RECONCILIATION_REASONS,
  RECONCILIATION_RESULTS,
  SERVER_REFUSAL_REASONS,
  type AuthorizeInput,
  type AuthorizeResponse,
  type CompleteInput,
  type CompleteResponse,
  type MoneyAmount,
  type ReconciledCall,
  type ReconciliationReason,
  type ReconciliationResult,
  type ServerRefusalReason,
  type SolvaPayAgentClient,
  type UsageReport,
  type UsageReportResponse,
} from './client'
export { PROMPT_EXCERPT_MAX, promptFacts, type PromptFacts } from './prompt'
export {
  createAgentCalls,
  amountString,
  type AgentCall,
  type AgentCalls,
  type Allowed,
  type CallResult,
  type Logger,
  type RefusalReason,
  type Refused,
} from './calls'
export { isRecord, requireBoolean, requireInteger, requireString } from './guards'
