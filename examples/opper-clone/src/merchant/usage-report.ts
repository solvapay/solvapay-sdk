// Opper's usage for one user, as the usage report SolvaPay reconciles against
// (build plan §7m, decisions 2 and 9). Opper's analytics are organisation-wide
// on any key, so only the rows of the user's project count. Costs arrive as
// decimal strings with float error ("0.006261200000000001"); they are summed
// and rounded half-up to 1e-8 in integer arithmetic, never through a float.
import type { UsageReport } from '../agent-layer/client'
import type { UsageRow } from './opper-client'

export const USAGE_SOURCE = 'opper:/v2/analytics/usage'
/** What the report reads: per project, per decision tag, by the hour. */
export const USAGE_GROUP_BY = ['project_uuid', 'decision_id']

/** The 8 decimal places SolvaPay books USD to. */
const PLACES = 8
const REPORT_ID = /^[A-Za-z0-9_:.-]{1,128}$/
const DECIMAL = /^(\d+)(?:\.(\d+))?$/

export type UsageWindow = UsageReport['window']

/**
 * The report for one user. `calls` holds every decision of the project, also
 * outside the window (SolvaPay ignores those); `untagged` holds the project's
 * hour buckets without a decision that start inside the window.
 */
export function buildUsageReport(input: {
  userRef: string
  customerRef: string
  projectUuid: string
  window: UsageWindow
  rows: UsageRow[]
}): UsageReport {
  const { userRef, window } = input
  // ISO times carry ':' and '.', both allowed in a report id.
  const reportId = `${userRef}:${window.from}:${window.to}`
  if (!REPORT_ID.test(reportId)) {
    throw new Error(
      `Report id ${reportId} is over 128 characters or has characters outside [A-Za-z0-9_:.-]`,
    )
  }
  const from = parseInstant(window.from, 'window.from')
  const to = parseInstant(window.to, 'window.to')

  const byDecision = new Map<string, string[]>()
  const byBucket = new Map<number, string[]>()
  for (const row of input.rows) {
    if (group(row, 'project_uuid') !== input.projectUuid) continue
    if (roundToPlaces([row.cost]) === 0n) continue
    const decisionRef = group(row, 'decision_id')
    if (decisionRef !== null) {
      append(byDecision, decisionRef, row.cost)
      continue
    }
    const at = parseInstant(row.timeBucket, 'usage time bucket')
    if (at >= from && at < to) append(byBucket, at, row.cost)
  }

  return {
    reportId,
    customerRef: input.customerRef,
    source: USAGE_SOURCE,
    window: { from: window.from, to: window.to },
    calls: [...byDecision].map(([decisionRef, costs]) => ({
      decisionRef,
      costUsd: unitsToUsd(roundToPlaces(costs)),
    })),
    untagged: [...byBucket]
      .sort(([a], [b]) => a - b)
      .map(([at, costs]) => ({
        at: new Date(at).toISOString(),
        costUsd: unitsToUsd(roundToPlaces(costs)),
      })),
  }
}

/**
 * The exact sum of non-negative decimal strings, rounded half-up to 1e-8,
 * in units of 1e-8.
 */
export function roundToPlaces(values: string[]): bigint {
  const parsed = values.map(value => {
    const match = DECIMAL.exec(value)
    if (!match) throw new Error(`Usage cost ${JSON.stringify(value)} is not a decimal`)
    return { whole: match[1], fraction: match[2] ?? '' }
  })
  const scale = Math.max(PLACES, ...parsed.map(value => value.fraction.length))
  let sum = 0n
  for (const value of parsed) sum += BigInt(value.whole + value.fraction.padEnd(scale, '0'))
  const divisor = 10n ** BigInt(scale - PLACES)
  const units = sum / divisor
  return (sum % divisor) * 2n >= divisor ? units + 1n : units
}

/** Units of 1e-8 as a USD decimal string, trailing zeros trimmed, as `usdString`. */
export function unitsToUsd(units: bigint): string {
  const digits = units.toString().padStart(PLACES + 1, '0')
  const whole = digits.slice(0, -PLACES)
  const fraction = digits.slice(-PLACES).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

function group(row: UsageRow, key: string): string | null {
  const value = row.groups[key]
  if (value === undefined) throw new Error(`Usage row was not grouped by ${key}`)
  return value
}

/** Milliseconds since the epoch; the string must name its zone, or it would read as local time. */
function parseInstant(value: string, label: string): number {
  const at = /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? Date.parse(value) : NaN
  if (Number.isNaN(at)) throw new Error(`${label} ${value} is not an ISO 8601 time with a zone`)
  return at
}

function append<K>(map: Map<K, string[]>, key: K, cost: string): void {
  const costs = map.get(key)
  if (costs) costs.push(cost)
  else map.set(key, [cost])
}
