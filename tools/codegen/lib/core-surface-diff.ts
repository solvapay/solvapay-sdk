export type Bump = 'major' | 'minor' | 'patch'

export type SurfaceFinding = {
  bump: Bump
  summary: string
}

export type SurfaceArtifacts = {
  bindingSymbols: unknown
  boundaryTypes: unknown
  sdkContract: unknown
  facadeCoverage: unknown
}

const BUMP_RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 }
const NAME_KEYS = ['ts', 'py', 'rb', 'go', 'rust', 'c'] as const

export function maxBump(findings: readonly SurfaceFinding[]): Bump | null {
  if (findings.length === 0) return null
  return findings.reduce<Bump>(
    (acc, item) => (BUMP_RANK[item.bump] > BUMP_RANK[acc] ? item.bump : acc),
    'patch',
  )
}

export function classifyCoreSurface(
  baseline: SurfaceArtifacts,
  current: SurfaceArtifacts,
): SurfaceFinding[] {
  const findings: SurfaceFinding[] = []
  diffBindingSymbols(asRecord(baseline.bindingSymbols), asRecord(current.bindingSymbols), findings)
  diffBoundaryTypes(asRecord(baseline.boundaryTypes), asRecord(current.boundaryTypes), findings)
  diffSdkContract(asRecord(baseline.sdkContract), asRecord(current.sdkContract), findings)
  diffFacadeCoverage(asRecord(baseline.facadeCoverage), asRecord(current.facadeCoverage), findings)
  return findings
}

function diffBindingSymbols(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  findings: SurfaceFinding[],
): void {
  const before = asRecord(baseline.bindings)
  const after = asRecord(current.bindings)
  for (const id of keys(before)) {
    if (!(id in after)) {
      findings.push({ bump: 'major', summary: `removed symbol \`${id}\`` })
    }
  }
  for (const id of keys(after)) {
    if (!(id in before)) {
      findings.push({ bump: 'minor', summary: `added symbol \`${id}\`` })
      continue
    }
    diffOneSymbol(id, asRecord(before[id]), asRecord(after[id]), findings)
  }
}

function diffOneSymbol(
  id: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  findings: SurfaceFinding[],
): void {
  if (before.return !== after.return) {
    findings.push({
      bump: 'major',
      summary: `changed return kind of \`${id}\` from \`${String(before.return)}\` to \`${String(after.return)}\``,
    })
  }
  const beforeNames = asRecord(before.names)
  const afterNames = asRecord(after.names)
  for (const lang of NAME_KEYS) {
    if (
      beforeNames[lang] !== afterNames[lang] &&
      (beforeNames[lang] !== undefined || afterNames[lang] !== undefined)
    ) {
      findings.push({
        bump: 'major',
        summary: `changed ${lang} name of \`${id}\` from \`${String(beforeNames[lang])}\` to \`${String(afterNames[lang])}\``,
      })
    }
  }
  const beforeArgs = asArgMap(before.args)
  const afterArgs = asArgMap(after.args)
  for (const name of keys(beforeArgs)) {
    if (!(name in afterArgs)) {
      findings.push({ bump: 'major', summary: `removed argument \`${name}\` from \`${id}\`` })
      continue
    }
    const prev = beforeArgs[name]
    const next = afterArgs[name]
    if (prev.type !== next.type) {
      findings.push({
        bump: 'major',
        summary: `retyped argument \`${name}\` on \`${id}\` from \`${prev.type}\` to \`${next.type}\``,
      })
    }
    if (prev.required !== next.required) {
      if (next.required && !prev.required) {
        findings.push({ bump: 'major', summary: `made argument \`${name}\` required on \`${id}\`` })
      } else {
        findings.push({ bump: 'minor', summary: `made argument \`${name}\` optional on \`${id}\`` })
      }
    }
  }
  for (const name of keys(afterArgs)) {
    if (name in beforeArgs) continue
    const next = afterArgs[name]
    if (next.required) {
      findings.push({ bump: 'major', summary: `added required argument \`${name}\` to \`${id}\`` })
    } else {
      findings.push({ bump: 'minor', summary: `added optional argument \`${name}\` to \`${id}\`` })
    }
  }
  const structural =
    stable(pick(before, ['return', 'names', 'args', 'sync', 'envelope'])) !==
    stable(pick(after, ['return', 'names', 'args', 'sync', 'envelope']))
  if (!structural && stable(before) !== stable(after)) {
    findings.push({ bump: 'patch', summary: `updated docs or metadata for symbol \`${id}\`` })
  }
}

function diffBoundaryTypes(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  findings: SurfaceFinding[],
): void {
  const before = asRecord(baseline.types)
  const after = asRecord(current.types)
  for (const id of keys(before)) {
    if (!(id in after)) {
      findings.push({ bump: 'major', summary: `removed boundary type \`${id}\`` })
    }
  }
  for (const id of keys(after)) {
    if (!(id in before)) {
      findings.push({ bump: 'minor', summary: `added boundary type \`${id}\`` })
      continue
    }
    const prevType = asRecord(before[id])
    const nextType = asRecord(after[id])
    const serde = String(nextType.serde ?? prevType.serde)
    const isInput = serde === 'deserialize' || serde === 'both'
    const isOutput = serde === 'serialize' || serde === 'both'
    const prevFields = fieldMap(prevType)
    const nextFields = fieldMap(nextType)
    for (const name of keys(prevFields)) {
      if (!(name in nextFields)) {
        if (isOutput) {
          findings.push({
            bump: 'major',
            summary: `removed field \`${name}\` from boundary output type \`${id}\``,
          })
        } else {
          findings.push({
            bump: 'minor',
            summary: `removed field \`${name}\` from boundary type \`${id}\``,
          })
        }
        continue
      }
      const prev = prevFields[name]
      const next = nextFields[name]
      if (stable(prev.ty) !== stable(next.ty)) {
        findings.push({
          bump: 'major',
          summary: `retyped field \`${name}\` on boundary type \`${id}\``,
        })
      }
      if (prev.optional !== next.optional && next.optional === false && isInput) {
        findings.push({
          bump: 'major',
          summary: `added required field \`${name}\` to boundary input type \`${id}\``,
        })
      }
    }
    for (const name of keys(nextFields)) {
      if (name in prevFields) continue
      const next = nextFields[name]
      if (next.optional === false && isInput) {
        findings.push({
          bump: 'major',
          summary: `added required field \`${name}\` to boundary input type \`${id}\``,
        })
      } else {
        findings.push({
          bump: 'minor',
          summary: `added optional field \`${name}\` to boundary type \`${id}\``,
        })
      }
    }
    if (
      fieldKeysEqual(prevFields, nextFields) &&
      stable(pick(prevType, ['shape'])) !== stable(pick(nextType, ['shape']))
    ) {
      findings.push({
        bump: 'patch',
        summary: `updated docs or metadata for boundary type \`${id}\``,
      })
    }
  }
}

function diffSdkContract(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  findings: SurfaceFinding[],
): void {
  const beforeOps = asRecord(baseline.operations)
  const afterOps = asRecord(current.operations)
  for (const id of keys(beforeOps)) {
    if (!(id in afterOps)) {
      findings.push({ bump: 'major', summary: `removed catalog op \`${id}\`` })
    }
  }
  for (const id of keys(afterOps)) {
    if (!(id in beforeOps)) {
      const op = asRecord(afterOps[id])
      const route = asRecord(op.route)
      const method = String(route.method ?? '')
      const path = String(route.path ?? '')
      findings.push({
        bump: 'minor',
        summary: `added \`${id}\`${method && path ? ` (${method} ${path})` : ''}`,
      })
      continue
    }
    diffOneOp(id, asRecord(beforeOps[id]), asRecord(afterOps[id]), findings)
  }
  diffErrors(asRecord(baseline.errors), asRecord(current.errors), findings)
  if (stable(baseline.defaults) !== stable(current.defaults)) {
    findings.push({ bump: 'minor', summary: 'changed frozen `defaults` block' })
  }
}

function diffOneOp(
  id: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  findings: SurfaceFinding[],
): void {
  const beforeRoute = asRecord(before.route)
  const afterRoute = asRecord(after.route)
  if (beforeRoute.method !== afterRoute.method || beforeRoute.path !== afterRoute.path) {
    findings.push({
      bump: 'major',
      summary: `changed route of \`${id}\` from \`${String(beforeRoute.method)} ${String(beforeRoute.path)}\` to \`${String(afterRoute.method)} ${String(afterRoute.path)}\``,
    })
  }
  const beforeNames = asRecord(before.names)
  const afterNames = asRecord(after.names)
  for (const lang of NAME_KEYS) {
    if (beforeNames[lang] !== afterNames[lang]) {
      findings.push({
        bump: 'major',
        summary: `changed ${lang} name of \`${id}\` from \`${String(beforeNames[lang])}\` to \`${String(afterNames[lang])}\``,
      })
    }
  }
  const beforeParams = asArgMap(before.params)
  const afterParams = asArgMap(after.params)
  for (const name of keys(beforeParams)) {
    if (!(name in afterParams)) {
      findings.push({ bump: 'major', summary: `removed argument \`${name}\` from \`${id}\`` })
      continue
    }
    if (
      beforeParams[name].type !== afterParams[name].type &&
      beforeParams[name].type &&
      afterParams[name].type
    ) {
      findings.push({
        bump: 'major',
        summary: `retyped argument \`${name}\` on \`${id}\``,
      })
    }
    if (!beforeParams[name].required && afterParams[name].required) {
      findings.push({ bump: 'major', summary: `made argument \`${name}\` required on \`${id}\`` })
    }
  }
  for (const name of keys(afterParams)) {
    if (name in beforeParams) continue
    if (afterParams[name].required) {
      findings.push({ bump: 'major', summary: `added required argument \`${name}\` to \`${id}\`` })
    } else {
      findings.push({ bump: 'minor', summary: `added optional argument \`${name}\` to \`${id}\`` })
    }
  }
  diffSyncMatrix(id, asRecord(before.sync), asRecord(after.sync), findings)
  const beforeDocs = asRecord(before.docs)
  const afterDocs = asRecord(after.docs)
  const structural =
    stable(pick(before, ['route', 'names', 'params', 'sync', 'errors'])) !==
    stable(pick(after, ['route', 'names', 'params', 'sync', 'errors']))
  if (!structural && beforeDocs.summary !== afterDocs.summary) {
    findings.push({ bump: 'patch', summary: `updated docs for \`${id}\`` })
  } else if (!structural && stable(before) !== stable(after)) {
    findings.push({ bump: 'patch', summary: `updated catalog metadata for \`${id}\`` })
  }
}

function diffSyncMatrix(
  id: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  findings: SurfaceFinding[],
): void {
  const langs = new Set([...keys(before), ...keys(after)])
  for (const lang of langs) {
    const prev = flavors(before[lang])
    const next = flavors(after[lang])
    for (const flavor of prev) {
      if (!next.has(flavor)) {
        findings.push({
          bump: 'major',
          summary: `removed ${lang} \`${flavor}\` flavor from \`${id}\``,
        })
      }
    }
    for (const flavor of next) {
      if (!prev.has(flavor)) {
        findings.push({ bump: 'minor', summary: `added ${lang} \`${flavor}\` flavor to \`${id}\`` })
      }
    }
  }
}

function diffErrors(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  findings: SurfaceFinding[],
): void {
  const before = errorCodes(baseline)
  const after = errorCodes(current)
  for (const code of before) {
    if (!after.has(code)) {
      findings.push({ bump: 'major', summary: `removed error code \`${code}\`` })
    }
  }
  for (const code of after) {
    if (!before.has(code)) {
      findings.push({ bump: 'minor', summary: `added error code \`${code}\`` })
    }
  }
}

function diffFacadeCoverage(
  baseline: Record<string, unknown>,
  current: Record<string, unknown>,
  findings: SurfaceFinding[],
): void {
  const before = asRecord(baseline.ops)
  const after = asRecord(current.ops)
  const opIds = new Set([...keys(before), ...keys(after)])
  for (const op of opIds) {
    const prevFacades = asRecord(before[op])
    const nextFacades = asRecord(after[op])
    const facades = new Set([...keys(prevFacades), ...keys(nextFacades)])
    for (const facade of facades) {
      const prev = isExposed(prevFacades[facade])
      const next = isExposed(nextFacades[facade])
      if (prev && !next) {
        findings.push({ bump: 'major', summary: `withdrew \`${op}\` from facade \`${facade}\`` })
      } else if (!prev && next) {
        findings.push({ bump: 'minor', summary: `exposed \`${op}\` on facade \`${facade}\`` })
      }
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function keys(record: Record<string, unknown>): string[] {
  return Object.keys(record).sort()
}

function asArgMap(value: unknown): Record<string, { type: string; required: boolean }> {
  if (!Array.isArray(value)) return {}
  const out: Record<string, { type: string; required: boolean }> = {}
  for (const item of value) {
    const rec = asRecord(item)
    const name = typeof rec.name === 'string' ? rec.name : ''
    if (!name) continue
    const type =
      typeof rec.type === 'string' ? rec.type : typeof rec.ref === 'string' ? rec.ref : ''
    out[name] = { type, required: rec.required === true }
  }
  return out
}

function fieldMap(
  type: Record<string, unknown>,
): Record<string, { optional: boolean; ty: unknown }> {
  const shape = asRecord(type.shape)
  if (!Array.isArray(shape.fields)) return {}
  const out: Record<string, { optional: boolean; ty: unknown }> = {}
  for (const item of shape.fields) {
    const rec = asRecord(item)
    const name =
      typeof rec.wireName === 'string'
        ? rec.wireName
        : typeof rec.rustName === 'string'
          ? rec.rustName
          : ''
    if (!name) continue
    out[name] = { optional: rec.optional === true, ty: rec.ty }
  }
  return out
}

function fieldKeysEqual(
  a: Record<string, { optional: boolean; ty: unknown }>,
  b: Record<string, { optional: boolean; ty: unknown }>,
): boolean {
  const ak = Object.keys(a).sort()
  const bk = Object.keys(b).sort()
  return ak.length === bk.length && ak.every((key, i) => key === bk[i])
}

function flavors(value: unknown): Set<string> {
  if (typeof value === 'string') return new Set([value])
  if (Array.isArray(value))
    return new Set(value.filter((item): item is string => typeof item === 'string'))
  return new Set()
}

function errorCodes(errors: Record<string, unknown>): Set<string> {
  const codes = new Set<string>()
  for (const [group, raw] of Object.entries(errors)) {
    const rec = asRecord(raw)
    if (Array.isArray(rec.codes)) {
      for (const code of rec.codes) {
        if (typeof code === 'string') codes.add(`${group}.${code}`)
      }
    }
    const messages = asRecord(rec.messages)
    for (const code of Object.keys(messages)) {
      codes.add(`${group}.${code}`)
    }
  }
  return codes
}

function isExposed(value: unknown): boolean {
  return asRecord(value).exposed === true
}

function pick(
  record: Record<string, unknown>,
  keysToKeep: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keysToKeep) {
    if (key in record) out[key] = record[key]
  }
  return out
}

function stable(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (typeof value === 'object' && value !== null) {
    const rec = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(rec).sort()) {
      out[key] = sortValue(rec[key])
    }
    return out
  }
  return value
}
