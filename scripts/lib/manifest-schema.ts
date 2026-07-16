/**
 * Zod schema + pure validation helpers for the SDK contract manifest.
 *
 * No filesystem I/O — callers load YAML/JSON and pass plain objects in.
 */

import { z } from 'zod'

export const LANGUAGES = ['ts', 'py', 'rb', 'go', 'rust'] as const
export type Language = (typeof LANGUAGES)[number]

export const EXPECTED_OPERATION_COUNT = 36

export const EXPECTED_TOP_LEVEL_IDS = [
  'verifyWebhook',
  'withRetry',
  'buildPaywallGate',
  'buildGateMessage',
  'buildNudgeMessage',
  'classifyPaywallState',
  'paywallErrorToClientPayload',
  'SolvaPayError',
  'PaywallError',
] as const

const LangNames = z.object({
  ts: z.string().min(1),
  py: z.string().min(1),
  rb: z.string().min(1),
  go: z.string().min(1),
  rust: z.string().min(1),
})

const PartialLangNames = z.object({
  ts: z.string().min(1).optional(),
  py: z.string().min(1).optional(),
  rb: z.string().min(1).optional(),
  go: z.string().min(1).optional(),
  rust: z.string().min(1).optional(),
})

const ClientSyncMatrix = z.object({
  ts: z.literal('async'),
  py: z.array(z.enum(['async', 'blocking'])).nonempty(),
  rb: z.literal('blocking'),
  go: z.literal('blocking'),
  rust: z.array(z.enum(['async', 'blocking'])).nonempty(),
})

const PureSyncMatrix = z.object({
  ts: z.literal('sync'),
  py: z.literal('sync'),
  rb: z.literal('sync'),
  go: z.literal('sync'),
  rust: z.literal('sync'),
})

const SyncMatrix = z.union([ClientSyncMatrix, PureSyncMatrix])

const Idempotency = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('autoKey'), format: z.string().min(1) }),
  z.object({
    kind: z.literal('headerForwarded'),
    header: z.literal('Idempotency-Key'),
  }),
])

const ErrorCase = z.object({
  status: z.number().optional(),
  messageTemplate: z.string().min(1),
  code: z.string().optional(),
})

const Operation = z.object({
  route: z.object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    path: z.string().min(1),
  }),
  names: LangNames,
  optionalOnClient: z.boolean().default(false),
  request: z.string().min(1).optional(),
  response: z.string().min(1),
  overlays: z.array(z.string()).default([]),
  normalization: z.array(z.string()).default([]),
  idempotency: Idempotency,
  errors: z.object({
    default: z.object({ messageTemplate: z.string().min(1) }),
    cases: z.array(ErrorCase).default([]),
  }),
  sync: ClientSyncMatrix,
})

const NamedEntry = z.object({
  names: LangNames,
  sync: SyncMatrix,
})

export const SdkContractManifestSchema = z.object({
  operations: z.record(z.string(), Operation),
  topLevel: z.record(z.string(), NamedEntry),
  coreHelpers: z.record(z.string(), NamedEntry),
  facade: z.record(z.string(), NamedEntry),
  errors: z.object({
    webhook: z.object({
      codes: z
        .array(z.string().min(1))
        .refine(
          codes =>
            [
              'missing_signature',
              'malformed_signature',
              'timestamp_too_old',
              'invalid_signature',
              'invalid_payload',
            ].every(c => codes.includes(c)),
          { message: 'webhook.codes must include the five stable webhook codes' },
        ),
    }),
  }),
  defaults: z.object({
    retry: z.object({
      maxRetries: z.literal(2),
      initialDelayMs: z.literal(500),
      backoff: z.literal('fixed'),
    }),
    webhookToleranceSec: z.literal(300),
    limitsCacheTTLMs: z.literal(10000),
    idempotencyKeyFormats: z.object({
      payment: z.literal('payment-{planRef}-{epochMs}-{random9}'),
      topup: z.literal('topup-{epochMs}-{random9}'),
    }),
    goContextFirstParam: z.literal(true),
  }),
  nameOverrides: z.record(z.string(), PartialLangNames).default({}),
  reservedWords: z
    .object({
      ts: z.array(z.string()).default([]),
      py: z.array(z.string()).default([]),
      rb: z.array(z.string()).default([]),
      go: z.array(z.string()).default([]),
      rust: z.array(z.string()).default([]),
    })
    .default({ ts: [], py: [], rb: [], go: [], rust: [] }),
})

export type SdkContractManifest = z.infer<typeof SdkContractManifestSchema>
export type LangNames = z.infer<typeof LangNames>
export type OperationEntry = z.infer<typeof Operation>

export interface OpenApiSnapshot {
  paths?: Record<string, Record<string, unknown> | undefined>
  components?: {
    schemas?: Record<string, unknown>
  }
}

/** Split camelCase / PascalCase into snake_case segments. */
export function toSnakeCase(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

export function toPascalCase(id: string): string {
  if (id.length === 0) {
    return id
  }
  return id[0].toUpperCase() + id.slice(1)
}

/**
 * Deterministic per-language names from a canonical camelCase id (§5.6).
 * Manual escapes live only in manifest `nameOverrides`.
 */
export function deriveNames(operationId: string): LangNames {
  const snake = toSnakeCase(operationId)
  return {
    ts: operationId,
    py: snake,
    rb: snake,
    go: toPascalCase(operationId),
    rust: snake,
  }
}

type NamedSection = 'operations' | 'topLevel' | 'coreHelpers' | 'facade'

function allNamedEntries(
  manifest: SdkContractManifest,
): Array<{ section: NamedSection; id: string; names: LangNames }> {
  const out: Array<{ section: NamedSection; id: string; names: LangNames }> = []
  for (const [id, entry] of Object.entries(manifest.operations)) {
    out.push({ section: 'operations', id, names: entry.names })
  }
  for (const [id, entry] of Object.entries(manifest.topLevel)) {
    out.push({ section: 'topLevel', id, names: entry.names })
  }
  for (const [id, entry] of Object.entries(manifest.coreHelpers)) {
    out.push({ section: 'coreHelpers', id, names: entry.names })
  }
  for (const [id, entry] of Object.entries(manifest.facade)) {
    out.push({ section: 'facade', id, names: entry.names })
  }
  return out
}

export function assertNameCoverage(manifest: SdkContractManifest): string[] {
  const issues: string[] = []
  for (const { section, id, names } of allNamedEntries(manifest)) {
    for (const lang of LANGUAGES) {
      const value = names[lang]
      if (typeof value !== 'string' || value.trim() === '') {
        issues.push(`Coverage: ${section}.${id} missing non-empty ${lang} name`)
      }
    }
  }
  return issues
}

export function assertNameCorrectness(manifest: SdkContractManifest): string[] {
  const issues: string[] = []
  for (const { section, id, names } of allNamedEntries(manifest)) {
    const derived = deriveNames(id)
    const overrides = manifest.nameOverrides[id] ?? {}
    for (const lang of LANGUAGES) {
      const expected = overrides[lang] ?? derived[lang]
      if (names[lang] !== expected) {
        issues.push(
          `Name correctness: ${section}.${id}.${lang} is "${names[lang]}", expected "${expected}"`,
        )
      }
    }
  }
  return issues
}

export function assertNoNameCollisions(manifest: SdkContractManifest): string[] {
  const issues: string[] = []
  for (const lang of LANGUAGES) {
    const seen = new Map<string, string>()
    for (const { section, id, names } of allNamedEntries(manifest)) {
      const name = names[lang]
      const owner = `${section}.${id}`
      const prior = seen.get(name)
      if (prior !== undefined) {
        issues.push(`Name collision (${lang}): "${name}" used by ${prior} and ${owner}`)
      } else {
        seen.set(name, owner)
      }
    }
  }
  return issues
}

export function assertOperationCount(manifest: SdkContractManifest): string[] {
  const count = Object.keys(manifest.operations).length
  if (count !== EXPECTED_OPERATION_COUNT) {
    return [
      `Operation count: expected ${EXPECTED_OPERATION_COUNT}, found ${count}`,
    ]
  }
  return []
}

export function assertTopLevelSet(manifest: SdkContractManifest): string[] {
  const actual = new Set(Object.keys(manifest.topLevel))
  const expected = new Set<string>(EXPECTED_TOP_LEVEL_IDS)
  const issues: string[] = []
  for (const id of expected) {
    if (!actual.has(id)) {
      issues.push(`Top-level set: missing ${id}`)
    }
  }
  for (const id of actual) {
    if (!expected.has(id)) {
      issues.push(`Top-level set: unexpected ${id}`)
    }
  }
  return issues
}

function methodKey(method: string): string {
  return method.toLowerCase()
}

export function crossCheckOpenApi(
  manifest: SdkContractManifest,
  snapshot: OpenApiSnapshot,
): string[] {
  const issues: string[] = []
  const paths = snapshot.paths ?? {}
  const schemas = snapshot.components?.schemas ?? {}

  for (const [id, operation] of Object.entries(manifest.operations)) {
    const pathItem = paths[operation.route.path]
    const method = methodKey(operation.route.method)
    if (!pathItem || pathItem[method] === undefined) {
      issues.push(
        `OpenAPI route: operations.${id} ${operation.route.method} ${operation.route.path} not found in snapshot`,
      )
    }

    const overlaySet = new Set(operation.overlays)
    const refs = [operation.request, operation.response].filter(
      (ref): ref is string => typeof ref === 'string',
    )
    for (const ref of refs) {
      if (overlaySet.has(ref)) {
        continue
      }
      if (!(ref in schemas)) {
        issues.push(
          `OpenAPI schema: operations.${id} DTO ref "${ref}" not in components.schemas (and not listed in overlays)`,
        )
      }
    }
  }

  return issues
}

export function validateManifestSemantics(manifest: SdkContractManifest): string[] {
  return [
    ...assertOperationCount(manifest),
    ...assertTopLevelSet(manifest),
    ...assertNameCoverage(manifest),
    ...assertNameCorrectness(manifest),
    ...assertNoNameCollisions(manifest),
  ]
}
