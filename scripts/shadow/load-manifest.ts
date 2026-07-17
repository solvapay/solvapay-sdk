/**
 * Load + validate the SDK contract manifest for shadow rules.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  SdkContractManifestSchema,
  type SdkContractManifest,
} from '../lib/manifest-schema.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_MANIFEST = path.join(REPO_ROOT, 'contract/manifest/sdk-contract.yaml')

export function loadShadowManifest(
  manifestPath: string = DEFAULT_MANIFEST,
): SdkContractManifest {
  const raw = parseYaml(readFileSync(manifestPath, 'utf8'))
  const parsed = SdkContractManifestSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`Invalid manifest: ${parsed.error.message}`)
  }
  return parsed.data
}
