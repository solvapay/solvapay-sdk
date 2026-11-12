/**
 * Fills in `expect` for cases that have none, from what the TypeScript SDK
 * does. Never changes an existing `expect`: to change one on purpose, edit it
 * by hand so the change shows in review.
 *
 * When an operation has more than one implementation, they must agree, or
 * nothing is recorded for that case.
 */
import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { asJson, CASES_DIR, loadCases, type Expect } from './cases'
import { implementationsFor, outcomeOf } from './operations'

let recorded = 0
const disagreements: string[] = []

for (const { file, data } of loadCases()) {
  if (data.expect !== undefined) continue

  const outcomes: Expect[] = []
  for (const implementation of implementationsFor(data)) {
    const outcome = await outcomeOf(implementation, data)
    outcomes.push('result' in outcome ? { result: asJson(outcome.result) } : outcome)
  }
  if (!outcomes.every(outcome => isDeepStrictEqual(outcome, outcomes[0]))) {
    disagreements.push(relative(CASES_DIR, file))
    continue
  }

  writeFileSync(file, `${JSON.stringify({ ...data, expect: outcomes[0] }, null, 2)}\n`)
  console.log(`recorded ${relative(CASES_DIR, file)}`)
  recorded++
}

console.log(`${recorded} case(s) recorded`)
if (disagreements.length > 0) {
  console.error(
    `The implementations disagree, nothing recorded for:\n  - ${disagreements.join('\n  - ')}`,
  )
  process.exit(1)
}
