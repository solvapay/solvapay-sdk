/**
 * Shadow-mode orchestrator: run TS + Rust clients side by side.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  SHADOW_SCENARIOS,
  resolveArgs,
  type ShadowScenario,
  type SideRefs,
} from '../../contract/shadow/scenarios.js'
import { compareSides, type SideOutcome } from './compare.js'
import { loadShadowManifest } from './load-manifest.js'
import { shadowRulesForOperation } from './normalize.js'
import {
  formatHumanSummary,
  writeShadowReport,
  type ScenarioResult,
  type ShadowReport,
} from './report.js'
import { invokeRustShadow } from './rust-driver.js'
import { installTsDriverSession, type TsDriver } from './ts-driver.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export type OrchestratorOptions = {
  baseUrl: string
  apiKey: string
  mode: 'live' | 'selftest'
  /** When set, stripe / activePurchase scenarios run instead of skipping. */
  enableRequires?: boolean
  outDir?: string
  rustBinPath?: string
  scenarios?: ShadowScenario[]
}

function extractRef(value: unknown, keys: string[]): string | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const obj = value as Record<string, unknown>
  for (const key of keys) {
    const v = obj[key]
    if (typeof v === 'string' && v.length > 0) return v
  }
  // Nested product/plan wrappers
  for (const nest of ['product', 'plan', 'customer']) {
    const nested = obj[nest]
    if (nested && typeof nested === 'object') {
      const found = extractRef(nested, keys)
      if (found) return found
    }
  }
  return undefined
}

async function setupSide(
  label: 'ts' | 'rust',
  invoke: (fn: string, args: Record<string, unknown>) => Promise<SideOutcome>,
  runId: string,
): Promise<SideRefs> {
  const sideTag = `${label}-${runId}`
  const email = `shadow-${sideTag}@example.com`
  const productOutcome = await invoke('createProduct', {
    // Names must be unique per side on live backends; `name` is volatile.
    name: `Shadow Product ${sideTag}`,
    config: {},
    metadata: {},
  })
  if (!productOutcome.ok) {
    throw new Error(`${label} setup createProduct failed: ${JSON.stringify(productOutcome.value)}`)
  }
  const productRef = extractRef(productOutcome.value, ['reference', 'productRef'])
  if (!productRef) {
    throw new Error(`${label} setup missing productRef: ${JSON.stringify(productOutcome.value)}`)
  }

  const planOutcome = await invoke('createPlan', {
    productRef,
    name: `Shadow Plan ${sideTag}`,
    type: 'recurring',
    billingCycle: 'monthly',
    price: 1000,
    currency: 'usd',
  })
  if (!planOutcome.ok) {
    throw new Error(`${label} setup createPlan failed: ${JSON.stringify(planOutcome.value)}`)
  }
  const planRef = extractRef(planOutcome.value, ['reference', 'planRef'])
  if (!planRef) {
    throw new Error(`${label} setup missing planRef: ${JSON.stringify(planOutcome.value)}`)
  }

  const customerOutcome = await invoke('createCustomer', { email })
  if (!customerOutcome.ok) {
    throw new Error(
      `${label} setup createCustomer failed: ${JSON.stringify(customerOutcome.value)}`,
    )
  }
  const customerRef = extractRef(customerOutcome.value, ['customerRef', 'reference'])
  if (!customerRef) {
    throw new Error(
      `${label} setup missing customerRef: ${JSON.stringify(customerOutcome.value)}`,
    )
  }

  return { productRef, planRef, customerRef, email, sideTag }
}

function shouldSkip(
  scenario: ShadowScenario,
  enableRequires: boolean | undefined,
): string | undefined {
  if (!scenario.requires) return undefined
  if (enableRequires) return undefined
  return scenario.skipReason ?? `requires: ${scenario.requires}`
}

export async function runShadowSuite(
  options: OrchestratorOptions,
): Promise<ShadowReport> {
  const startedAt = new Date().toISOString()
  const manifest = loadShadowManifest()
  const scenarios = options.scenarios ?? SHADOW_SCENARIOS
  const results: ScenarioResult[] = []

  const session = installTsDriverSession({
    apiKey: options.apiKey,
    apiBaseUrl: options.baseUrl,
  })
  const tsDriver: TsDriver = session.driver

  const invokeTs = (fn: string, args: Record<string, unknown>) => tsDriver.invoke(fn, args)
  const invokeRust = (fn: string, args: Record<string, unknown>) =>
    invokeRustShadow(
      {
        fn,
        argsJson: args,
        baseUrl: options.baseUrl,
        apiKey: options.apiKey,
      },
      { binPath: options.rustBinPath },
    )

  try {
    const runId = `${Date.now()}`
    const tsRefs = await setupSide('ts', invokeTs, runId)
    const rustRefs = await setupSide('rust', invokeRust, runId)

    for (const scenario of scenarios) {
      const skip = shouldSkip(scenario, options.enableRequires)
      if (skip) {
        results.push({
          op: scenario.op,
          scenarioId: scenario.id,
          status: 'SKIPPED',
          reason: skip,
        })
        continue
      }

      // Skip catalog setup duplicates that already ran in setupSide when they
      // would re-create resources with unresolved placeholders — still run them
      // with resolved refs so coverage is exercised.
      const tsArgs = resolveArgs(scenario.args, tsRefs)
      const rustArgs = resolveArgs(scenario.args, rustRefs)

      try {
        const [tsOutcome, rustOutcome] = await Promise.all([
          invokeTs(scenario.op, tsArgs),
          invokeRust(scenario.op, rustArgs),
        ])

        // Refresh refs when create* scenarios mint new resources
        if (scenario.op === 'createProduct' && tsOutcome.ok) {
          const ref = extractRef(tsOutcome.value, ['reference', 'productRef'])
          if (ref) tsRefs.productRef = ref
        }
        if (scenario.op === 'createProduct' && rustOutcome.ok) {
          const ref = extractRef(rustOutcome.value, ['reference', 'productRef'])
          if (ref) rustRefs.productRef = ref
        }
        if (scenario.op === 'createPlan' && tsOutcome.ok) {
          const ref = extractRef(tsOutcome.value, ['reference', 'planRef'])
          if (ref) tsRefs.planRef = ref
        }
        if (scenario.op === 'createPlan' && rustOutcome.ok) {
          const ref = extractRef(rustOutcome.value, ['reference', 'planRef'])
          if (ref) rustRefs.planRef = ref
        }
        if (scenario.op === 'createCustomer' && tsOutcome.ok) {
          const ref = extractRef(tsOutcome.value, ['customerRef', 'reference'])
          if (ref) tsRefs.customerRef = ref
        }
        if (scenario.op === 'createCustomer' && rustOutcome.ok) {
          const ref = extractRef(rustOutcome.value, ['customerRef', 'reference'])
          if (ref) rustRefs.customerRef = ref
        }

        const rules = shadowRulesForOperation(manifest, scenario.op)
        const compared = compareSides({
          op: scenario.op,
          args: { ts: tsArgs, rust: rustArgs },
          ts: tsOutcome,
          rust: rustOutcome,
          rules,
        })

        if (compared.identical) {
          results.push({
            op: scenario.op,
            scenarioId: scenario.id,
            status: 'IDENTICAL',
          })
        } else {
          results.push({
            op: scenario.op,
            scenarioId: scenario.id,
            status: 'DIVERGED',
            divergence: compared.divergence,
          })
        }
      } catch (error) {
        results.push({
          op: scenario.op,
          scenarioId: scenario.id,
          status: 'ERROR',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    session.restore()
  }

  const report: ShadowReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    mode: options.mode,
    results,
  }

  const outDir =
    options.outDir ?? path.join(REPO_ROOT, 'contract/shadow/output')
  writeShadowReport(report, outDir)
  return report
}

export function printReport(report: ShadowReport): void {
  // eslint-disable-next-line no-console
  console.log(formatHumanSummary(report))
}

export function reportHasFailures(report: ShadowReport): boolean {
  return report.results.some(r => r.status === 'DIVERGED' || r.status === 'ERROR')
}
