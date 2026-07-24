/**
 * Historical one-shot backfill (step 18). Prefer `pnpm gen:scaffold` for new ops.
 *
 * Inject `params` (+ new overlays / typeParams) into sdk-contract.yaml
 * without reformatting the whole document.
 *
 * Usage: pnpm exec tsx scripts/populate-manifest-params.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import {
  entryBounds,
  insertBeforeSync as insertBeforeSyncBase,
  renderYamlFragment,
} from './lib/manifest-edit.js'
import {
  FACADE_PARAMS,
  OPERATION_PARAMS,
  PARAM_OVERLAYS,
  TOP_LEVEL_PARAMS,
  TOP_LEVEL_TYPE_PARAMS,
  type ParamDefInput,
} from './lib/operation-params.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(REPO_ROOT, 'contract/manifest/sdk-contract.yaml')

function paramsYaml(params: ParamDefInput[], indent: number): string {
  if (params.length === 0) {
    return `${' '.repeat(indent)}params: []\n`
  }
  return renderYamlFragment({ params }, indent)
}

function typeParamsYaml(typeParams: { name: string }[], indent: number): string {
  return renderYamlFragment({ typeParams }, indent)
}

function insertBeforeSync(text: string, entryId: string, insert: string): string {
  return insertBeforeSyncBase(text, entryId, insert, { replaceKey: 'params' })
}

function insertOverlays(raw: string): string {
  const marker = '  UpdateCustomerResult:\n'
  const idx = raw.indexOf(marker)
  if (idx === -1) {
    throw new Error('UpdateCustomerResult overlay not found')
  }
  let block = ''
  for (const [name, overlay] of Object.entries(PARAM_OVERLAYS)) {
    if (raw.includes(`  ${name}:\n`)) {
      continue
    }
    const rendered = stringify(
      { [name]: overlay },
      {
        lineWidth: 0,
        defaultKeyType: 'PLAIN',
        defaultStringType: 'PLAIN',
      },
    )
    block +=
      rendered
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => `  ${line}`)
        .join('\n') + '\n'
  }
  if (block === '') {
    return raw
  }
  return raw.slice(0, idx) + block + raw.slice(idx)
}

function ensureOpOverlayList(raw: string, opId: string, overlayName: string): string {
  const { start, end } = entryBounds(raw, opId)
  const full = raw.slice(start, end)
  const overlaysLine = full.match(/^    overlays: \[(.*)\]$/m)
  if (overlaysLine === null) {
    return raw
  }
  const inner = overlaysLine[1] ?? ''
  if (
    inner
      .split(',')
      .map(s => s.trim())
      .includes(overlayName)
  ) {
    return raw
  }
  const next = inner.trim() === '' ? overlayName : `${inner}, ${overlayName}`
  const replaced = full.replace(overlaysLine[0], `    overlays: [${next}]`)
  return raw.slice(0, start) + replaced + raw.slice(end)
}

function main(): void {
  let raw = readFileSync(MANIFEST_PATH, 'utf8')

  raw = insertOverlays(raw)

  for (const [id, params] of Object.entries(OPERATION_PARAMS)) {
    raw = insertBeforeSync(raw, id, paramsYaml(params, 4))
  }

  for (const [id, params] of Object.entries(TOP_LEVEL_PARAMS)) {
    let insert = paramsYaml(params, 4)
    const typeParams = TOP_LEVEL_TYPE_PARAMS[id]
    if (typeParams !== undefined) {
      insert += typeParamsYaml(typeParams, 4)
    }
    raw = insertBeforeSync(raw, id, insert)
  }

  for (const [id, params] of Object.entries(FACADE_PARAMS)) {
    raw = insertBeforeSync(raw, id, paramsYaml(params, 4))
  }

  const coreStart = raw.indexOf('\ncoreHelpers:\n')
  const facadeStart = raw.indexOf('\nfacade:\n')
  if (coreStart !== -1 && facadeStart !== -1 && facadeStart > coreStart) {
    let coreSection = raw.slice(coreStart, facadeStart)
    const helperIds = [...coreSection.matchAll(/^  ([A-Za-z][A-Za-z0-9]*):$/gm)].map(m => m[1]!)
    for (const id of helperIds) {
      const { start, end } = entryBounds(coreSection, id)
      const full = coreSection.slice(start, end)
      if (!/^    params:/m.test(full)) {
        coreSection = insertBeforeSync(coreSection, id, paramsYaml([], 4))
      }
    }
    raw = raw.slice(0, coreStart) + coreSection + raw.slice(facadeStart)
  }

  const overlayLinks: Array<[string, string]> = [
    ['updateCustomer', 'UpdateCustomerParams'],
    ['cancelPurchase', 'CancelPurchaseParams'],
    ['reactivatePurchase', 'ReactivatePurchaseParams'],
    ['getUserInfo', 'GetUserInfoParams'],
    ['cloneProduct', 'CloneProductOverrides'],
    ['createPlan', 'CreatePlanParams'],
    ['saveAutoRecharge', 'SaveAutoRechargeParams'],
  ]
  for (const [opId, overlayName] of overlayLinks) {
    raw = ensureOpOverlayList(raw, opId, overlayName)
  }

  writeFileSync(MANIFEST_PATH, raw)
  console.log(`Updated ${MANIFEST_PATH}`)
}

main()
