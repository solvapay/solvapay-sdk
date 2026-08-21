/**
 * Load + validate the SDK contract manifest for shadow rules.
 */

import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import { SdkContractManifestSchema, type SdkContractManifest } from '../../shared/manifest-schema.js'
import { contractInputPath } from '../../shared/repo-paths.js'

const DEFAULT_MANIFEST = contractInputPath('sdkManifest')

export function loadShadowManifest(manifestPath: string = DEFAULT_MANIFEST): SdkContractManifest {
  const raw = parseYaml(readFileSync(manifestPath, 'utf8'))
  const parsed = SdkContractManifestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid manifest: ${parsed.error.message}`)
  }
  return parsed.data
}
