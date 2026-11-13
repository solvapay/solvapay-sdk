import { readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `conformance/cases`, the language-neutral cases every SDK runs. */
export const CASES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'cases')

export type Expect = { result: unknown } | { error: { code: string } }

export interface ConformanceCase {
  suite: string
  case: string
  description: string
  input: {
    fn: string
    args: Record<string, unknown>
    clock?: string
  }
  expect?: Expect
}

/** What one scenario step must produce: its outcome, and the API calls it made, in order. */
export type StepExpect = (
  | { result: unknown }
  | { error: { code: string } }
  | { gate: Record<string, unknown> }
) & { apiCalls: unknown[] }

export interface ScenarioStep {
  fn: string
  args: Record<string, unknown>
  clock: string
  api?: { method: string; path: string; status?: number; body: unknown }[]
  expect?: StepExpect
}

/** Several steps against one SDK instance, so state kept between calls is tested. */
export interface ScenarioCase {
  suite: string
  case: string
  description: string
  setup: { productRef: string; limitsCacheTtlMs?: number }
  steps: ScenarioStep[]
}

export interface LoadedCase {
  file: string
  data: ConformanceCase | ScenarioCase
}

export const isScenario = (data: ConformanceCase | ScenarioCase): data is ScenarioCase =>
  'steps' in data

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Every case under `cases/`, checked against the rules `case.schema.json`
 * states. A case that breaks them fails loading, so a typo cannot quietly turn
 * a case into one that never runs.
 */
export function loadCases(): LoadedCase[] {
  const cases: LoadedCase[] = []
  for (const suite of readdirSync(CASES_DIR, { withFileTypes: true })) {
    if (!suite.isDirectory()) continue
    const suiteDir = join(CASES_DIR, suite.name)
    for (const entry of readdirSync(suiteDir).sort()) {
      const file = join(suiteDir, entry)
      if (!entry.endsWith('.json')) {
        throw new Error(`${relative(CASES_DIR, file)}: only .json files belong in a suite`)
      }
      const data = JSON.parse(readFileSync(file, 'utf-8')) as ConformanceCase | ScenarioCase
      if (isScenario(data)) checkScenario(file, suite.name, basename(entry, '.json'), data)
      else checkCase(file, suite.name, basename(entry, '.json'), data)
      cases.push({ file, data })
    }
  }
  if (cases.length === 0) throw new Error(`No conformance cases found in ${CASES_DIR}`)
  return cases
}

function checkCase(file: string, suite: string, name: string, data: ConformanceCase): void {
  const where = relative(CASES_DIR, file)
  const problems: string[] = []
  if (data.suite !== suite) problems.push(`suite is "${data.suite}", the folder is "${suite}"`)
  if (data.case !== name) problems.push(`case is "${data.case}", the file is "${name}"`)
  if (!NAME.test(name)) problems.push('the file name must be lowercase words joined by dashes')
  if (!data.description?.trim()) problems.push('description is missing')
  if (typeof data.input?.fn !== 'string') problems.push('input.fn is missing')
  if (typeof data.input?.args !== 'object' || data.input.args === null) {
    problems.push('input.args must be an object')
  }
  if (data.input?.clock !== undefined && Number.isNaN(Date.parse(data.input.clock))) {
    problems.push('input.clock is not a date-time')
  }
  if (data.expect !== undefined) {
    const keys = Object.keys(data.expect)
    const isResult = keys.length === 1 && keys[0] === 'result'
    const isError =
      keys.length === 1 &&
      keys[0] === 'error' &&
      typeof (data.expect as { error: { code?: unknown } }).error?.code === 'string'
    if (!isResult && !isError) {
      problems.push('expect must be { "result": … } or { "error": { "code": "…" } }')
    }
  }
  if (problems.length > 0) throw new Error(`${where}: ${problems.join('; ')}`)
}

function checkScenario(file: string, suite: string, name: string, data: ScenarioCase): void {
  const where = relative(CASES_DIR, file)
  const problems: string[] = []
  if (data.suite !== suite) problems.push(`suite is "${data.suite}", the folder is "${suite}"`)
  if (data.case !== name) problems.push(`case is "${data.case}", the file is "${name}"`)
  if (!NAME.test(name)) problems.push('the file name must be lowercase words joined by dashes')
  if (!data.description?.trim()) problems.push('description is missing')
  if ('input' in data || 'expect' in data) {
    problems.push('a scenario has steps, not input/expect')
  }
  if (typeof data.setup?.productRef !== 'string') problems.push('setup.productRef is missing')
  if (!Array.isArray(data.steps) || data.steps.length < 2) {
    problems.push('a scenario needs at least two steps')
  } else {
    data.steps.forEach((step, i) => {
      if (typeof step.fn !== 'string') problems.push(`steps[${i}].fn is missing`)
      if (typeof step.args !== 'object' || step.args === null) {
        problems.push(`steps[${i}].args must be an object`)
      }
      if (typeof step.clock !== 'string' || Number.isNaN(Date.parse(step.clock))) {
        problems.push(`steps[${i}].clock must be a date-time`)
      }
      if (step.expect !== undefined && !Array.isArray(step.expect.apiCalls)) {
        problems.push(`steps[${i}].expect.apiCalls must be a list`)
      }
    })
    const recorded = data.steps.filter(step => step.expect !== undefined).length
    if (recorded !== 0 && recorded !== data.steps.length) {
      problems.push('either every step has expect, or none does')
    }
  }
  if (problems.length > 0) throw new Error(`${where}: ${problems.join('; ')}`)
}

/**
 * A value as it would travel as JSON, so results compare the same in every
 * language: undefined keys drop out, dates become strings.
 */
export function asJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}
