#!/usr/bin/env tsx
/**
 * Replace `file:npm/*` optionalDependencies with the loader version and
 * stamp platform package versions. Fails if any platform binary is missing.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { joinRel, lookupRel, REPO_ROOT } from '../shared/paths.js'
import { loadSupportMatrix } from './lib/support-matrix.js'

const LOADER_REL = lookupRel('nodeNativePackage')
const NPM_REL = lookupRel('nodeNativeNpm')

const loaderAbs = joinRel(REPO_ROOT, LOADER_REL)
const loader = JSON.parse(readFileSync(loaderAbs, 'utf8')) as {
  name: string
  version: string
  optionalDependencies?: Record<string, string>
}

if (typeof loader.version !== 'string' || loader.version.length === 0) {
  throw new Error('prepare-native-publish: loader version missing')
}

const matrix = loadSupportMatrix(REPO_ROOT)
const optionalDependencies: Record<string, string> = {}
const missing: string[] = []

for (const target of matrix.nodeNative.targets) {
  const rel = `${NPM_REL}/${target.dir}`
  const binary = joinRel(REPO_ROOT, rel, target.binary)
  if (!existsSync(binary)) {
    missing.push(`${target.packageName}: missing ${rel}/${target.binary}`)
    continue
  }
  const pkgAbs = joinRel(REPO_ROOT, rel, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgAbs, 'utf8')) as Record<string, unknown>
  pkg.version = loader.version
  writeFileSync(pkgAbs, `${JSON.stringify(pkg, null, 2)}\n`)
  optionalDependencies[target.packageName] = loader.version
}

if (missing.length > 0) {
  console.error('prepare-native-publish: HARD FAIL — platform binaries missing:')
  for (const line of missing) console.error(`  ${line}`)
  console.error(
    'Build the 8 napi targets and place artifacts with `napi artifacts` before publish.',
  )
  process.exit(1)
}

loader.optionalDependencies = optionalDependencies
writeFileSync(loaderAbs, `${JSON.stringify(loader, null, 2)}\n`)
console.log(
  `prepare-native-publish: OK ${loader.name}@${loader.version} (${matrix.nodeNative.targets.length} platform pins)`,
)
