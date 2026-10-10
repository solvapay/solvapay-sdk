// The spend policy check for an agent's paid calls (agent payments PoC, S5):
// SolvaPay decides each call against the agent's spend policy before Opper is
// called, and an allow reserves the estimate. After the call the reservation
// is settled at what the credit debit uses, or released when nothing ran.
// Build plan §7e, decisions 4, 8 and 10.
//
// A sub-module beside `./metering` rather than a hook in the SDK's cost mode;
// it moves into `payable` at promotion.
import { amountToSettle, type CallResult } from './metering'
import type { ModelTier } from './pricing'
import type {
  DecideResponse,
  PolicySettleSource,
  SettleResponse,
  SolvaPayAgentClient,
} from './client'

export interface PolicySettled {
  source: PolicySettleSource
  amountUsd: string | null
  response: SettleResponse
}

interface DecisionFields {
  decisionRef: string
  reasonCode: string
  reasonText: string
  policy: { reference: string; version: number } | null
  budget: DecideResponse['budget'] | null
  /** The month's approval, when SolvaPay reports one; shown to the human, never acted on. */
  approval: DecideResponse['approval'] | null
  /** How long SolvaPay took to decide, round trip, in milliseconds. */
  decideMs: number
}

export type Decided =
  | (DecisionFields & {
      action: 'allow'
      /** Moves the call's cost from reserved to spent, by the metering rules. Once per call. */
      settle(result: CallResult): Promise<PolicySettled>
      /** Drops the reservation: the call never reached the upstream. */
      release(): Promise<PolicySettled>
    })
  | (DecisionFields & { action: 'ask' | 'deny' })

export interface Policy {
  decide(input: {
    agentToken: string
    requestId: string
    model: string
    tier: ModelTier
    estimateUsd: string
  }): Promise<Decided>
}

export function createPolicy(deps: { client: SolvaPayAgentClient }): Policy {
  return {
    async decide({ agentToken, requestId, model, tier, estimateUsd }) {
      const started = performance.now()
      const decision = await deps.client.decide({
        agentToken,
        requestId,
        kind: 'inference',
        model,
        tier,
        estimatedCost: estimateUsd,
      })
      const decideMs = Math.round((performance.now() - started) * 10) / 10
      const fields: DecisionFields = {
        decisionRef: decision.decisionRef,
        reasonCode: decision.reasonCode,
        reasonText: decision.reasonText,
        policy: decision.policy ?? null,
        budget: decision.budget ?? null,
        approval: decision.approval ?? null,
        decideMs,
      }
      if (decision.action !== 'allow') return { ...fields, action: decision.action }

      let done = false
      async function send(
        source: PolicySettleSource,
        amountUsd: string | null,
      ): Promise<PolicySettled> {
        if (done) throw new Error(`Decision ${decision.decisionRef} is already settled`)
        done = true
        const response = await deps.client.settle({
          decisionRef: decision.decisionRef,
          source,
          ...(amountUsd !== null ? { amountUsd } : {}),
        })
        return { source, amountUsd, response }
      }

      return {
        ...fields,
        action: 'allow',
        settle(result) {
          const amount = amountToSettle(result, estimateUsd)
          return amount ? send(amount.source, amount.amountUsd) : send('none', null)
        },
        release: () => send('none', null),
      }
    },
  }
}
