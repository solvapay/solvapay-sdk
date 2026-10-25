// Makes the saved agent ask its owner for more budget, without Claude Code
// or Opper: one decide priced past what is left of the month's budget opens
// the approval (email and push to the owner's devices), then the script
// waits on its status URL while the owner approves or declines, and decides
// again to show the outcome. Any reservation it makes is released at once,
// so nothing is spent.
//
//   pnpm agent:ask [estimate USD, default 0.24] [--wait seconds, default 900]
//
// Uses data/agent-credential (pnpm agent:connect) and the merchant's
// SOLVAPAY_SECRET_KEY. The estimate must stay under the policy's per-call
// cap, or the call is denied instead of asking.
import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createSolvaPayAgentClient, type DecideResponse } from '@solvapay/agent-layer'

const POLL_MS = 2_000

const base = required('SOLVAPAY_API_BASE_URL').replace(/\/+$/, '')
const secretKey = required('SOLVAPAY_SECRET_KEY')
const consoleUrl = required('ACCOUNT_CONSOLE_URL').replace(/\/+$/, '')
const client = createSolvaPayAgentClient({ apiBaseUrl: base, secretKey })

const args = process.argv.slice(2)
const waitFlag = args.indexOf('--wait')
const waitSeconds = waitFlag === -1 ? 900 : Number(args.splice(waitFlag, 2)[1])
const estimate = args[0] ?? '0.24'
if (!/^\d+(\.\d+)?$/.test(estimate)) fail(`Estimate must be a USD amount, got "${estimate}"`)
if (!Number.isFinite(waitSeconds) || waitSeconds < 0) fail('--wait must be a number of seconds')

const run = Date.now().toString(36)
let n = 0

async function main() {
  const token = await agentToken()
  const first = await decide(token)
  show('Decision', first)

  if (first.action === 'allow') {
    await release(first)
    const left = first.budget
      ? Number(first.budget.effectiveBudgetUsd) -
        Number(first.budget.spentUsd) -
        Number(first.budget.reservedUsd)
      : NaN
    fail(
      `Allowed: about $${left.toFixed(4)} is left of this month's budget, more than $${estimate}. ` +
        'Lower it with `pnpm agent:connect policy update budget=<USD>`, or ask with a larger estimate under the per-call cap.',
    )
  }
  if (first.action === 'deny') fail('Denied, so there is nothing to approve.')
  const approval = first.approval
  if (!approval)
    fail('Asked without an approval: the ceiling leaves nothing to approve this month.')
  if (approval.status === 'declined') {
    fail(
      `Approval ${approval.reference} was declined this month and holds until the policy changes.`,
    )
  }

  console.log(`\nApproval ${approval.reference} is waiting. Check your phone, or open:`)
  console.log(`  ${consoleUrl}/approvals/${approval.reference}`)
  console.log(`Waiting up to ${waitSeconds}s (it expires at ${approval.expiresAt})…`)

  const status = await waitFor(approval.statusUrl, waitSeconds * 1000)
  console.log(`\nApproval ${approval.reference}: ${status}`)
  if (status !== 'approved') process.exit(1)

  const again = await decide(await agentToken())
  show('Decision after approving', again)
  if (again.action === 'allow') await release(again)
  process.exit(again.action === 'allow' ? 0 : 1)
}

async function agentToken(): Promise<string> {
  const credentialFile = fileURLToPath(new URL('../data/agent-credential', import.meta.url))
  const credential = (await readFile(credentialFile, 'utf8')).trim()
  const response = await fetch(`${base}/v1/agent/tokens`, {
    method: 'POST',
    headers: { authorization: `Bearer ${credential}` },
  })
  const text = await response.text()
  if (!response.ok) fail(`Minting an agent token failed (${response.status}): ${text}`)
  return (JSON.parse(text) as { token: string }).token
}

function decide(agentToken: string): Promise<DecideResponse> {
  return client.decide({
    agentToken,
    requestId: `ask-for-budget-${run}-${(n += 1)}`,
    kind: 'usage',
    item: 'ask-for-budget',
    estimatedCost: estimate,
  })
}

/** Nothing was called, so the reservation goes back at once. */
async function release(decision: DecideResponse) {
  await client.settle({ decisionRef: decision.decisionRef, source: 'none' })
}

async function waitFor(statusUrl: string, timeoutMs: number): Promise<string> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const response = await fetch(statusUrl, { headers: { authorization: `Bearer ${secretKey}` } })
    const text = await response.text()
    if (!response.ok) fail(`Reading the approval failed (${response.status}): ${text}`)
    const { status } = JSON.parse(text) as { status: string }
    if (status !== 'pending') return status
    if (Date.now() >= until) return 'still pending (stopped waiting)'
    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }
}

function show(label: string, decision: DecideResponse) {
  console.log(`\n${label}: ${decision.action} (${decision.reasonCode})`)
  console.log(`  ${decision.reasonText}`)
  if (decision.budget) {
    const b = decision.budget
    console.log(
      `  spent $${b.spentUsd}, reserved $${b.reservedUsd}, budget $${b.effectiveBudgetUsd}, ceiling $${b.ceilingUsd}`,
    )
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) fail(`${name} is not set in .env`)
  return value
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

main().catch(error => fail(error instanceof Error ? error.message : String(error)))
