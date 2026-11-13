import { describe, expect, it } from 'vitest'
import { asJson, isScenario, loadCases } from './cases'
import { implementationsFor, outcomeOf } from './operations'
import { runScenario } from './scenarios'

const cases = loadCases()
const suites = [...new Set(cases.map(({ data }) => data.suite))]
const RECORD_HINT =
  'Run `pnpm --filter @solvapay/conformance-typescript record` and review the result.'

for (const suite of suites) {
  describe(suite, () => {
    for (const { data } of cases.filter(({ data }) => data.suite === suite)) {
      if (isScenario(data)) {
        it(`${data.case} (scenario, ${data.steps.length} steps)`, async () => {
          if (data.steps.some(step => step.expect === undefined)) {
            throw new Error(`The scenario has steps without expect. ${RECORD_HINT}`)
          }
          const outcomes = await runScenario(data)
          data.steps.forEach((step, i) => {
            expect(outcomes[i], `step ${i + 1} (${step.fn}): ${data.description}`).toStrictEqual(
              step.expect,
            )
          })
        })
        continue
      }
      for (const implementation of implementationsFor(data)) {
        it(`${data.case} (${implementation.name})`, async () => {
          if (data.expect === undefined) {
            throw new Error(`The case has no expect. ${RECORD_HINT}`)
          }
          const outcome = await outcomeOf(implementation, data)
          const actual = 'result' in outcome ? { result: asJson(outcome.result) } : outcome
          expect(actual, data.description).toStrictEqual(data.expect)
        })
      }
    }
  })
}
