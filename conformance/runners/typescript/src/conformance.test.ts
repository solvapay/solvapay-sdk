import { describe, expect, it } from 'vitest'
import { asJson, loadCases } from './cases'
import { implementationsFor, outcomeOf } from './operations'

const cases = loadCases()
const suites = [...new Set(cases.map(({ data }) => data.suite))]

for (const suite of suites) {
  describe(suite, () => {
    for (const { data } of cases.filter(({ data }) => data.suite === suite)) {
      for (const implementation of implementationsFor(data)) {
        it(`${data.case} (${implementation.name})`, async () => {
          if (data.expect === undefined) {
            throw new Error(
              'The case has no expect. Run `pnpm --filter @solvapay/conformance-typescript record` and review the result.',
            )
          }
          const outcome = await outcomeOf(implementation, data)
          const actual = 'result' in outcome ? { result: asJson(outcome.result) } : outcome
          expect(actual, data.description).toStrictEqual(data.expect)
        })
      }
    }
  })
}
