/**
 * `@solvapay/agent-layer` — what a merchant needs to be paid by SolvaPay
 * agents: verify the agent token, decide each call against its owner's spend
 * policy, hold while an approval waits for the owner, gate on the balance and
 * settle at the cost the upstream reported.
 *
 * Private for now: the Opper clone (HTTP) and the Opper MCP server (MCP) both
 * run on it, and it moves into `@solvapay/server` once both have proven its
 * shape (DEV-1109). Protocol-neutral: no route, no Anthropic or MCP types.
 */
export {
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
  APPROVAL_STATUSES,
  createSolvaPayAgentClient,
  parseApprovalStatus,
  parseUsageReportResponse,
  RECONCILIATION_REASONS,
  RECONCILIATION_RESULTS,
  type ApprovalStatus,
  type ApprovalStatusResponse,
  type DecideApproval,
  type DecideInput,
  type DecideResponse,
  type ReconciledCall,
  type ReconciliationReason,
  type ReconciliationResult,
  type SettleInput,
  type SettleResponse,
  type SolvaPayAgentClient,
  type UsageReport,
  type UsageReportResponse,
} from './client'
export { createPolicy, type Decided, type Policy, type PolicySettled } from './policy'
export {
  createApprovalWait,
  type ApprovalWait,
  type WaitOutcome,
  type WaitResult,
} from './approval-wait'
export {
  amountToSettle,
  createMetering,
  findCustomerRef,
  usdString,
  type CallResult,
  type Metering,
  type Opened,
  type Settled,
} from './metering'
export { PROMPT_EXCERPT_MAX, promptFacts, type PromptFacts } from './prompt'
export {
  createAgentCalls,
  decisionFields,
  finishedFields,
  type AgentCall,
  type AgentCalls,
  type Allowed,
  type Finished,
  type Logger,
  type RefusalReason,
  type Refused,
} from './calls'
export { isRecord, requireBoolean, requireInteger, requireString } from './guards'
