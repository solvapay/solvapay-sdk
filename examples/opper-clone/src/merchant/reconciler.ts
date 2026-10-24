// Reconciliation as the merchant runs it (build plan §7m, decisions 1, 9 and
// 13): for each user account with a SolvaPay customer, read Opper's usage on
// the user's project, report it to SolvaPay per decision, and rotate the
// user's key when SolvaPay flags usage that did not come through the agent
// layer. The window runs from the start of the previous UTC month to 15
// minutes ago, so repeating it is harmless and a call still settling is never
// read as absent.
import type { SolvaPay } from '@solvapay/server'
import {
  RECONCILIATION_RESULTS,
  type ReconciledCall,
  type ReconciliationResult,
  type SolvaPayAgentClient,
  type UsageReportResponse,
} from '../agent-layer/client'
import { findCustomerRef } from '../agent-layer/metering'
import { isRecord, requireString } from '../lib/guards'
import type { KvStore } from '../lib/kv-store'
import type { Logger } from '../log'
import type { OpperAccounts } from './opper-accounts'
import { buildUsageReport, USAGE_GROUP_BY, type UsageWindow } from './usage-report'

/** SolvaPay refuses a window that ends less than 10 minutes ago; 15 leaves room. */
const SETTLE_MARGIN_MS = 15 * 60_000

export type ReconcileOutcome =
  | {
      userRef: string
      status: 'reported'
      customerRef: string
      reference: string
      duplicate: boolean
      counts: Record<ReconciliationResult, number>
      /** Every result other than `matched`. */
      unmatched: ReconciledCall[]
      untagged: UsageReportResponse['untagged']
      keyRotated: boolean
    }
  /** A user with no SolvaPay customer at this merchant, such as a merchant-key user. */
  | { userRef: string; status: 'skipped'; reason: 'no_customer' }
  | { userRef: string; status: 'failed'; error: string }

export interface ReconcileRun {
  window: UsageWindow
  outcomes: ReconcileOutcome[]
}

export interface Reconciler {
  /** One pass over every account, or over one user's. A failing user does not stop the others. */
  runOnce(userRef?: string): Promise<ReconcileRun>
  /** Runs every `everyMinutes`, one run at a time; returns a stop function. */
  start(everyMinutes: number): () => void
}

export function createReconciler(deps: {
  accounts: Pick<OpperAccounts, 'userRefs' | 'projectUuid' | 'readUsage' | 'rotate'>
  /** Holds which untagged usage the last rotation answered, per user. */
  store: KvStore
  solvaPay: Pick<SolvaPay, 'getCustomer'>
  agentClient: Pick<SolvaPayAgentClient, 'reportUsage'>
  log: Logger
  now?: () => Date
}): Reconciler {
  const now = deps.now ?? (() => new Date())

  async function reconcileUser(userRef: string, window: UsageWindow): Promise<ReconcileOutcome> {
    const customerRef = await findCustomerRef(deps.solvaPay, userRef)
    if (customerRef === null) {
      deps.log.info('reconcile.skipped', { userRef, reason: 'no_customer' })
      return { userRef, status: 'skipped', reason: 'no_customer' }
    }
    const projectUuid = await deps.accounts.projectUuid(userRef)
    // Read to the present: a call made just after its decision is not cut off at `to`.
    const rows = await deps.accounts.readUsage(userRef, {
      groupBy: USAGE_GROUP_BY,
      granularity: 'hour',
      from: window.from,
    })
    const report = buildUsageReport({ userRef, customerRef, projectUuid, window, rows })
    const response = await deps.agentClient.reportUsage(report)

    const counts = Object.fromEntries(RECONCILIATION_RESULTS.map(result => [result, 0])) as Record<
      ReconciliationResult,
      number
    >
    for (const call of response.results) counts[call.result]++
    deps.log.info('reconcile.reported', {
      userRef,
      customerRef,
      reference: response.reference,
      duplicate: response.duplicate,
      window,
      calls: report.calls.length,
      results: counts,
      untaggedUsd: response.untagged.totalUsd,
      beforePolicyUsd: response.untagged.beforePolicyUsd,
      flagged: response.untagged.flagged,
    })

    const latestUntagged = report.untagged.at(-1)?.at ?? null
    const keyRotated = response.untagged.flagged && (await rotateFor(userRef, latestUntagged))
    return {
      userRef,
      status: 'reported',
      customerRef,
      reference: response.reference,
      duplicate: response.duplicate,
      counts,
      unmatched: response.results.filter(call => call.result !== 'matched'),
      untagged: response.untagged,
      keyRotated,
    }
  }

  /**
   * Rotates the key once per untagged usage: a flagged bucket stays in the
   * window for weeks, and a key minted after it cannot have made it. Rotates
   * again only when a later untagged bucket shows up.
   */
  async function rotateFor(userRef: string, latestUntagged: string | null): Promise<boolean> {
    const rotatedFor = await readRotatedFor(userRef)
    if (rotatedFor !== null && latestUntagged !== null && latestUntagged <= rotatedFor) {
      deps.log.info('reconcile.key_kept', { userRef, untaggedThrough: latestUntagged, rotatedFor })
      return false
    }
    const rotated = await deps.accounts.rotate(userRef)
    if (latestUntagged !== null) {
      await deps.store.put(
        rotationKey(userRef),
        JSON.stringify({ version: 1, rotatedFor: latestUntagged }),
      )
    }
    deps.log.info('reconcile.key_rotated', { userRef, ...rotated, untaggedThrough: latestUntagged })
    return true
  }

  async function readRotatedFor(userRef: string): Promise<string | null> {
    const raw = await deps.store.get(rotationKey(userRef))
    if (raw === null) return null
    const value = JSON.parse(raw) as unknown
    if (!isRecord(value) || value.version !== 1) {
      throw new Error(`Rotation record for ${userRef} is missing version 1`)
    }
    return requireString(value.rotatedFor, 'rotatedFor')
  }

  async function runOnce(userRef?: string): Promise<ReconcileRun> {
    const window = reconcileWindow(now())
    const userRefs = userRef ? [userRef] : await deps.accounts.userRefs()
    const outcomes: ReconcileOutcome[] = []
    for (const ref of userRefs) {
      try {
        outcomes.push(await reconcileUser(ref, window))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.log.error('reconcile.failed', { userRef: ref, error: message })
        outcomes.push({ userRef: ref, status: 'failed', error: message })
      }
    }
    return { window, outcomes }
  }

  return {
    runOnce,

    start(everyMinutes) {
      if (!Number.isInteger(everyMinutes) || everyMinutes < 1) {
        throw new Error('The reconcile interval must be a whole number of minutes, at least 1')
      }
      let running = false
      const timer = setInterval(() => {
        if (running) {
          deps.log.info('reconcile.tick_skipped', { reason: 'previous run still going' })
          return
        }
        running = true
        runOnce()
          .catch(error =>
            deps.log.error('reconcile.run_failed', {
              error: error instanceof Error ? error.message : String(error),
            }),
          )
          .finally(() => {
            running = false
          })
      }, everyMinutes * 60_000)
      return () => clearInterval(timer)
    },
  }
}

/** From the start of the previous UTC month to 15 minutes ago, to the second. */
export function reconcileWindow(now: Date): UsageWindow {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const to = new Date(now.getTime() - SETTLE_MARGIN_MS)
  return { from: isoSeconds(from), to: isoSeconds(to) }
}

function isoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`
}

function rotationKey(userRef: string): string {
  return `reconcile:${userRef}`
}
