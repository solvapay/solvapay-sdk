import { readFileSync } from 'node:fs'
import { joinRel, lookupRel } from '../../shared/paths.js'
import { readReleaseTrainVersion } from './release-train.js'

export const TEMPLATE_PIN_RELS = [
  lookupRel('templateMcpTsPackage'),
  lookupRel('templateMcpPythonPyproject'),
  lookupRel('templateMcpRubyGemfile'),
  lookupRel('templateMcpRustCargo'),
  lookupRel('templateMcpGoMod'),
] as const

export type TemplatePinDrift = {
  path: string
  expected: string
  actual: string
}

export function collectTemplatePinDrift(
  repoRoot: string,
  version = readReleaseTrainVersion(repoRoot),
): TemplatePinDrift[] {
  const drift: TemplatePinDrift[] = []
  const ts = JSON.parse(readFileSync(joinRel(repoRoot, TEMPLATE_PIN_RELS[0]), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const deps = ts.dependencies ?? {}
  for (const name of [
    '@solvapay/core',
    '@solvapay/mcp',
    '@solvapay/server',
    '@solvapay/server-wasm',
  ]) {
    const actual = deps[name] ?? ''
    const expected = `^${version}`
    if (actual !== expected)
      drift.push({ path: `${TEMPLATE_PIN_RELS[0]}:${name}`, expected, actual })
  }

  const py = readFileSync(joinRel(repoRoot, TEMPLATE_PIN_RELS[1]), 'utf8')
  for (const name of ['solvapay', 'solvapay-mcp']) {
    const match = py.match(new RegExp(`"${name}==([^"]+)"`))
    const actual = match?.[1] ?? ''
    if (actual !== version) {
      drift.push({ path: `${TEMPLATE_PIN_RELS[1]}:${name}`, expected: version, actual })
    }
  }

  const gem = readFileSync(joinRel(repoRoot, TEMPLATE_PIN_RELS[2]), 'utf8')
  for (const name of ['solvapay', 'solvapay-mcp']) {
    const match = gem.match(new RegExp(`gem "${name}", "([^"]+)"`))
    const actual = match?.[1] ?? ''
    if (actual !== version) {
      drift.push({ path: `${TEMPLATE_PIN_RELS[2]}:${name}`, expected: version, actual })
    }
  }

  const cargo = readFileSync(joinRel(repoRoot, TEMPLATE_PIN_RELS[3]), 'utf8')
  for (const name of ['solvapay', 'solvapay-mcp']) {
    const match = cargo.match(new RegExp(`${name} = "([^"]+)"`))
    const actual = match?.[1] ?? ''
    if (actual !== version) {
      drift.push({ path: `${TEMPLATE_PIN_RELS[3]}:${name}`, expected: version, actual })
    }
  }

  const gomod = readFileSync(joinRel(repoRoot, TEMPLATE_PIN_RELS[4]), 'utf8')
  const goMatch = gomod.match(/github.com\/solvapay\/solvapay-sdk\/sdks\/go v([^\s]+)/)
  const goActual = goMatch?.[1] ?? ''
  // Go module paths without /vN cannot require v2+. Keep the template on v0.0.0
  // (replace-pinned in --dev) instead of the unified 3.x train.
  const goExpected = '0.0.0'
  if (goActual !== goExpected) {
    drift.push({
      path: `${TEMPLATE_PIN_RELS[4]}:github.com/solvapay/solvapay-sdk/sdks/go`,
      expected: goExpected,
      actual: goActual,
    })
  }

  return drift
}

export function formatTemplatePinDrift(drift: readonly TemplatePinDrift[]): string {
  if (drift.length === 0) return 'template-pins: OK'
  return [
    `template-pins: ${drift.length} pin(s) drifted from unified version ${drift[0]?.expected}`,
    ...drift.map(item => `  ${item.path}: ${item.actual} (expected ${item.expected})`),
  ].join('\n')
}
