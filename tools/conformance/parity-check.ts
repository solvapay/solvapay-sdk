/**
 * Manifest-driven TypeScript parity / coverage check (step 18).
 *
 * Usage: pnpm parity:check
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { SdkContractManifestSchema, type SdkContractManifest } from '../shared/manifest-schema.js'
import { checkParity, formatParityReport } from './lib/parity.js'
import { REPO_ROOT } from '../shared/paths.js'
import { contractInputPath } from '../shared/repo-paths.js'
import { readTsSurface } from './lib/ts-surface.js'

const DEFAULT_MANIFEST = contractInputPath('sdkManifest')

function main(): number {
  const manifestPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_MANIFEST
  const raw = parseYaml(readFileSync(manifestPath, 'utf8'))
  const parsed = SdkContractManifestSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('Manifest schema validation failed:')
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
    }
    return 1
  }
  const manifest: SdkContractManifest = parsed.data
  const surface = readTsSurface(REPO_ROOT)
  const issues = checkParity({
    manifest,
    portableExports: surface.portableExports,
    clientMethods: surface.clientMethods,
    facadeMethods: surface.facadeMethods,
  })
  const report = formatParityReport(issues)
  if (issues.length > 0) {
    console.error(report)
    return 1
  }
  console.log(report)
  return 0
}

process.exit(main())
