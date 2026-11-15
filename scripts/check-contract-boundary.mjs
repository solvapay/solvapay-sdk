// Fails a pull request that changes the conformance contract and a language
// folder together. The contract (cases, their lock, the schema, openapi/) is
// the TypeScript SDK's: a language adopts new cases by updating its own pin
// (python/conformance.lock), never by editing them. Label the PR
// `contract-change` to allow both on purpose.
//
// Reads BASE_SHA, HEAD_SHA and PR_LABELS (a JSON list of label names).
import { execFileSync } from 'node:child_process'

const CONTRACT = /^(conformance\/(cases\/|cases\.lock$|case\.schema\.json$)|openapi\/)/
const LANGUAGE = /^(python|go|ruby)\//
const OVERRIDE = 'contract-change'

const { BASE_SHA: base, HEAD_SHA: head, PR_LABELS: labelsJson } = process.env
if (!base || !head) throw new Error('BASE_SHA and HEAD_SHA are required')
const labels = JSON.parse(labelsJson ?? '[]')

const changed = execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
  encoding: 'utf-8',
})
  .split('\n')
  .filter(Boolean)
const contract = changed.filter(file => CONTRACT.test(file))
const language = changed.filter(file => LANGUAGE.test(file))

if (contract.length === 0 || language.length === 0) {
  console.log('The PR changes the contract or a language, not both.')
  process.exit(0)
}
if (labels.includes(OVERRIDE)) {
  console.log(`Contract and language changed together, allowed by the "${OVERRIDE}" label.`)
  process.exit(0)
}
console.error(
  [
    'This PR changes the conformance contract and a language folder together.',
    `Contract: ${contract.slice(0, 10).join(', ')}${contract.length > 10 ? ', …' : ''}`,
    `Language: ${language.slice(0, 10).join(', ')}${language.length > 10 ? ', …' : ''}`,
    'Change the cases in a TypeScript PR first, then adopt them in a language PR.',
    `If both must land together, label the PR "${OVERRIDE}".`,
  ].join('\n'),
)
process.exit(1)
