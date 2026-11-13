/**
 * Fills in `expect` for cases that have none, from what the TypeScript SDK
 * does. Never changes an existing `expect`: to change one on purpose, edit it
 * by hand so the change shows in review.
 *
 * When an operation has more than one implementation, they must agree, or
 * nothing is recorded for that case.
 *
 * Then rewrites `conformance/cases.lock`, the fingerprint of every case. This
 * is the only thing that writes it.
 */
import { writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
  asJson,
  CASES_DIR,
  currentLock,
  isScenario,
  LOCK_FILE,
  loadCases,
  type Expect,
} from './cases'
import { implementationsFor, outcomeOf } from './operations'
import { runScenario } from './scenarios'

let recorded = 0
const disagreements: string[] = []

for (const { file, data } of loadCases()) {
  if (isScenario(data)) {
    if (data.steps.every(step => step.expect !== undefined)) continue
    const outcomes = await runScenario(data)
    const steps = data.steps.map((step, i) => ({ ...step, expect: outcomes[i] }))
    writeFileSync(file, `${JSON.stringify({ ...data, steps }, null, 2)}\n`)
    console.log(`recorded ${relative(CASES_DIR, file)}`)
    recorded++
    continue
  }
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
// Every case now has its expectation: fingerprint them all, including any edited by hand.
writeFileSync(LOCK_FILE, currentLock())
console.log(`wrote ${relative(process.cwd(), LOCK_FILE)}`)
// The SDK keeps timers open (its shared lookup cache), so leave explicitly.
process.exit(0)
