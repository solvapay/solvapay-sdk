/**
 * Shared binding stub helpers for gen-bindings / gen-scaffold.
 */

import { deriveNames, toSnakeCase } from '../../shared/manifest-schema.js'

export function nextClientEmitOrder(
  bindings: Record<string, { emitOrder?: number; artifact?: string }> | undefined,
): number {
  let max = -1
  for (const symbol of Object.values(bindings ?? {})) {
    if (symbol.artifact === 'client' && typeof symbol.emitOrder === 'number') {
      max = Math.max(max, symbol.emitOrder)
    }
  }
  return max + 1
}

export function clientBindingsFromYaml(
  doc: unknown,
): Record<string, { emitOrder?: number; artifact?: string }> | undefined {
  if (typeof doc !== 'object' || doc === null || !('bindings' in doc)) {
    return undefined
  }
  const bindings = doc.bindings
  if (typeof bindings !== 'object' || bindings === null) {
    return undefined
  }
  const out: Record<string, { emitOrder?: number; artifact?: string }> = {}
  for (const [id, value] of Object.entries(bindings)) {
    if (typeof value !== 'object' || value === null) {
      continue
    }
    const emitOrder =
      'emitOrder' in value && typeof value.emitOrder === 'number' ? value.emitOrder : undefined
    const artifact =
      'artifact' in value && typeof value.artifact === 'string' ? value.artifact : undefined
    out[id] = { emitOrder, artifact }
  }
  return out
}

export function bindingStubFields(input: {
  id: string
  method: string
  routePath: string
  pathRefs: string[]
  bodyParamName?: string
  dtoType?: string
  emitOrder: number
}): Record<string, unknown> {
  const names = deriveNames(input.id)
  const snake = toSnakeCase(input.id)
  const isSplit = input.pathRefs.length > 0
  const clientCallArgs = [
    ...input.pathRefs.map((_, i) => `&refs[${i}]`),
    ...(input.bodyParamName !== undefined
      ? [input.bodyParamName === 'overrides' ? 'Some(overrides)' : input.bodyParamName]
      : []),
  ]
  return {
    core: `solvapay_transport::SolvaPayClient::${snake}`,
    names,
    catalog: { kind: 'operation', id: input.id },
    args: [],
    splitPathRefs: input.pathRefs,
    return: 'value',
    sync: 'async',
    envelope: 'async',
    artifact: 'client',
    emitOrder: input.emitOrder,
    section: 'Group B',
    doc: `\`${input.method} ${input.routePath}\``,
    rustFnName: snake,
    call: {
      kind: 'wrap',
      serialize: isSplit ? 'clientSplit' : 'clientAwait',
    },
    coreCall: snake,
    ...(input.dtoType !== undefined ? { dtoType: input.dtoType } : {}),
    ...(isSplit ? { clientCallArgs } : {}),
  }
}
