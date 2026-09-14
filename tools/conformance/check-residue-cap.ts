#!/usr/bin/env tsx
/**
 * Fail when contract/manifest/binding-residue.yaml gains new top-level keys.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from '../shared/paths.js'

/** Last reviewed residue key count. Shrink this number as entries drain. */
export const RESIDUE_KEY_CAP = 57

export function countResidueKeys(yaml: string): number {
  return yaml.split('\n').filter(line => /^[A-Za-z_]/.test(line)).length
}

export function checkResidueCap(yaml: string, cap = RESIDUE_KEY_CAP): string | undefined {
  const count = countResidueKeys(yaml)
  if (count > cap) {
    return `binding-residue.yaml has ${count} keys; cap is ${cap}. Drain residue instead of adding language-specific overrides.`
  }
  return undefined
}

function main(): void {
  const yamlPath = path.join(REPO_ROOT, 'contract/manifest/binding-residue.yaml')
  const yaml = readFileSync(yamlPath, 'utf8')
  const error = checkResidueCap(yaml)
  if (error) {
    console.error(error)
    process.exit(1)
  }
  console.log(`binding-residue cap: ${countResidueKeys(yaml)} / ${RESIDUE_KEY_CAP}`)
}

const isDirectRun =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).endsWith('check-residue-cap.ts')
if (isDirectRun) {
  main()
}
