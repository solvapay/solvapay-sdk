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

export interface LoadedCase {
  file: string
  data: ConformanceCase
}

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
      const data = JSON.parse(readFileSync(file, 'utf-8')) as ConformanceCase
      checkCase(file, suite.name, basename(entry, '.json'), data)
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

/**
 * A value as it would travel as JSON, so results compare the same in every
 * language: undefined keys drop out, dates become strings.
 */
export function asJson(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}
