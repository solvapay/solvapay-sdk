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

/** Field / nested type reference used inside overlay definitions. */
export type OverlayTypeRef =
  | { type: 'string' }
  | { type: 'number' }
  | { type: 'integer' }
  | { type: 'boolean' }
  | { type: 'unknown' }
  | { ref: string }
  | { array: OverlayTypeRef }
  | { map: OverlayTypeRef }
  | { enum: string[] }
  | { literal: string | number | boolean }
  | { object: Record<string, OverlayField> }

export type OverlayField = OverlayTypeRef & {
  required?: boolean
  nullable?: boolean
  doc?: string
}

const OverlayTypeRefSchema: z.ZodType<OverlayTypeRef> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('string') }),
    z.object({ type: z.literal('number') }),
    z.object({ type: z.literal('integer') }),
    z.object({ type: z.literal('boolean') }),
    z.object({ type: z.literal('unknown') }),
    z.object({ ref: z.string().min(1) }),
    z.object({ array: OverlayTypeRefSchema }),
    z.object({ map: OverlayTypeRefSchema }),
    z.object({ enum: z.array(z.string().min(1)).nonempty() }),
    z.object({
      literal: z.union([z.string(), z.number(), z.boolean()]),
    }),
    z.object({ object: z.record(z.string(), OverlayFieldSchema) }),
  ]),
)

const OverlayFieldSchema: z.ZodType<OverlayField> = z.lazy(() =>
  z.intersection(
    OverlayTypeRefSchema,
    z.object({
      required: z.boolean().optional(),
      nullable: z.boolean().optional(),
      doc: z.string().optional(),
    }),
  ),
)

const OverlayNames = PartialLangNames

const ExtendDtoOverlay = z.object({
  kind: z.literal('extendDto'),
  base: z.string().min(1),
  doc: z.string().optional(),
  names: OverlayNames.optional(),
  /** When true, inherited base fields are treated as optional in the SDK shape. */
  partial: z.boolean().default(false),
  fields: z.record(z.string(), OverlayFieldSchema).default({}),
})

const MapDtoOverlay = z.object({
  kind: z.literal('mapDto'),
  base: z.string().min(1).optional(),
  doc: z.string().optional(),
  names: OverlayNames.optional(),
  /** Wire field → SDK field renames (e.g. reference → customerRef). */
  renames: z.record(z.string(), z.string().min(1)).default({}),
  fields: z.record(z.string(), OverlayFieldSchema),
})

const ProjectUnionOverlay = z.object({
  kind: z.literal('projectUnion'),
  base: z.string().min(1),
  doc: z.string().optional(),
  names: OverlayNames.optional(),
  /** IR / wire variant names to drop from the base union. */
  dropVariants: z.array(z.string().min(1)).default([]),
  /** Extra fields kept on the bare `succeeded` arm after projection. */
  succeededFields: z.record(z.string(), OverlayFieldSchema).default({}),
})

const SyntheticOverlay = z
  .object({
    kind: z.literal('synthetic'),
    doc: z.string().optional(),
    names: OverlayNames.optional(),
    /** `void` sentinel — emits a unit type. */
    unit: z.boolean().default(false),
    /** Catalog-only tag (no type emission). */
    marker: z.boolean().default(false),
    /** Re-export an existing IR/wire type under this overlay name. */
    aliasOf: z.string().min(1).optional(),
    /** Emit `Vec<Item>` under this overlay name. */
    arrayOf: z.string().min(1).optional(),
    /** Closed string enum (alternative to `fields`). */
    enum: z.array(z.string().min(1)).nonempty().optional(),
    fields: z.record(z.string(), OverlayFieldSchema).default({}),
  })
  .superRefine((value, ctx) => {
    const modes = [
      value.unit,
      value.marker,
      value.aliasOf !== undefined,
      value.arrayOf !== undefined,
      value.enum !== undefined,
      Object.keys(value.fields).length > 0,
    ].filter(Boolean).length
    if (modes !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'synthetic overlay must set exactly one of: unit, marker, aliasOf, arrayOf, enum, or fields',
      })
    }
  })

export const OverlaySchema = z.discriminatedUnion('kind', [
  ExtendDtoOverlay,
  MapDtoOverlay,
  ProjectUnionOverlay,
  SyntheticOverlay,
])

export type Overlay = z.infer<typeof OverlaySchema>

/** One positional / options-bag parameter in a catalogued entry point (§5.6). */
export type ParamDef = OverlayTypeRef & {
  name: string
  required?: boolean
  default?: string | number | boolean
  doc?: string
}

const ParamDefSchema: z.ZodType<ParamDef> = z.lazy(() =>
  z.intersection(
    OverlayTypeRefSchema,
    z.object({
      name: z.string().min(1),
      required: z.boolean().default(true),
      default: z.union([z.string(), z.number(), z.boolean()]).optional(),
      doc: z.string().optional(),
    }),
  ),
)

const TypeParamSchema = z.object({
  name: z.string().min(1),
})

/**
 * Per-operation shadow-mode volatile paths (step 25).
 * JSON Pointers (RFC 6901) whose values are replaced before TS/Rust compare.
 */
const OperationShadow = z
  .object({
    volatile: z.array(z.string()).default([]),
  })
  .default({ volatile: [] })

/**
 * Global shadow-mode volatile-field rules (step 25).
 * Applied recursively in addition to per-operation `shadow.volatile` pointers.
 */
const GlobalShadow = z
  .object({
    /** Object keys whose values are always treated as volatile. */
    globalVolatileKeys: z.array(z.string()).default([
      'createdAt',
      'updatedAt',
      'id',
      'reference',
      'idempotencyKey',
      'clientSecret',
      'sessionId',
      'email',
      'name',
    ]),
    /** Keys ending with these suffixes (e.g. `customerRef`) are volatile. */
    volatileKeySuffixes: z.array(z.string()).default(['Ref']),
    /**
     * String prefixes that mark SolvaPay resource refs (`prd_…`, `cus_…`).
     * Matching tokens in strings/URLs are normalized.
     */
    refPrefixes: z.array(z.string()).default([
      'prd_',
      'pln_',
      'cus_',
      'cusess_',
      'pur_',
      'pi_',
      'ses_',
      'usg_',
      'cs_',
      'top_',
      'mcp_',
    ]),
  })
  .default({
    globalVolatileKeys: [
      'createdAt',
      'updatedAt',
      'id',
      'reference',
      'idempotencyKey',
      'clientSecret',
      'sessionId',
      'email',
      'name',
    ],
    volatileKeySuffixes: ['Ref'],
    refPrefixes: [
      'prd_',
      'pln_',
      'cus_',
      'cusess_',
      'pur_',
      'pi_',
      'ses_',
      'usg_',
      'cs_',
      'top_',
      'mcp_',
    ],
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
  /** Positional parameter list for signature generation (§5.6 / step 18). */
  params: z.array(ParamDefSchema),
  overlays: z.array(z.string()).default([]),
  normalization: z.array(z.string()).default([]),
  /** Shadow-mode volatile JSON Pointers for this operation (step 25). */
  shadow: OperationShadow,
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
  /** Parameter list for callables / constructors (step 18). */
  params: z.array(ParamDefSchema).default([]),
  /** Generic type parameters (e.g. withRetry&lt;T&gt;). */
  typeParams: z.array(TypeParamSchema).optional(),
})

export const SdkContractManifestSchema = z.object({
  operations: z.record(z.string(), Operation),
  /** SDK-only overlay type catalog (§5.4). Keys are overlay names. */
  overlays: z.record(z.string(), OverlaySchema).default({}),
  topLevel: z.record(z.string(), NamedEntry),
  coreHelpers: z.record(z.string(), NamedEntry),
  facade: z.record(z.string(), NamedEntry),
  /** Global shadow-mode volatile rules (step 25). */
  shadow: GlobalShadow,
  errors: z
    .object({
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
        messages: z.object({
          missing_signature: z.string().min(1),
          malformed_signature: z.string().min(1),
          timestamp_too_old: z.string().min(1),
          invalid_signature: z.string().min(1),
          invalid_payload: z.string().min(1),
        }),
      }),
      paywall: z.object({
        messages: z.object({
          payment_required: z.string().min(1),
          activation_required: z.string().min(1),
        }),
      }),
      mcp: z.object({
        messages: z.object({
          rawHandlerReturn: z.string().min(1),
        }),
      }),
      transport: z.object({
        messageTemplate: z.string().min(1),
      }),
    })
    .superRefine((errors, ctx) => {
      for (const code of errors.webhook.codes) {
        if (!(code in errors.webhook.messages)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `webhook.messages missing entry for code ${code}`,
            path: ['webhook', 'messages', code],
          })
        }
      }
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
export type NamedEntry = z.infer<typeof NamedEntry>

/** Top-level ids that are callables (not error classes) and must declare params. */
export const TOP_LEVEL_CALLABLE_IDS = [
  'verifyWebhook',
  'withRetry',
  'buildPaywallGate',
  'buildGateMessage',
  'buildNudgeMessage',
  'classifyPaywallState',
  'paywallErrorToClientPayload',
] as const

/** Facade entry points that must declare params. */
export const FACADE_CALLABLE_IDS = [
  'createSolvaPay',
  'createSolvaPayClient',
  'payable',
  'protect',
  'gate',
] as const

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

function hasParamsArray(value: unknown): value is { params: unknown[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'params' in value &&
    Array.isArray((value as { params: unknown }).params)
  )
}

/**
 * Every operation and catalogued topLevel/facade callable must declare `params`
 * (may be an empty array for nullary methods).
 */
export function assertParamsCoverage(manifest: SdkContractManifest): string[] {
  const issues: string[] = []
  for (const id of Object.keys(manifest.operations)) {
    const entry = manifest.operations[id]
    if (!hasParamsArray(entry)) {
      issues.push(`Params: operations.${id} missing params`)
    }
  }
  for (const id of TOP_LEVEL_CALLABLE_IDS) {
    const entry = manifest.topLevel[id]
    if (entry === undefined) {
      issues.push(`Params: topLevel.${id} missing (expected callable)`)
      continue
    }
    if (!hasParamsArray(entry)) {
      issues.push(`Params: topLevel.${id} missing params`)
    }
  }
  for (const id of FACADE_CALLABLE_IDS) {
    const entry = manifest.facade[id]
    if (entry === undefined) {
      issues.push(`Params: facade.${id} missing (expected callable)`)
      continue
    }
    if (!hasParamsArray(entry)) {
      issues.push(`Params: facade.${id} missing params`)
    }
  }
  return issues
}

/** Collect named type refs from a param type expression (including nested objects). */
export function collectParamTypeRefs(param: ParamDef): string[] {
  return collectTypeRefs(param)
}

function methodKey(method: string): string {
  return method.toLowerCase()
}

/** Collect named type refs from an overlay type expression. */
export function collectTypeRefs(ty: OverlayTypeRef): string[] {
  if ('ref' in ty) {
    return [ty.ref]
  }
  if ('array' in ty) {
    return collectTypeRefs(ty.array)
  }
  if ('map' in ty) {
    return collectTypeRefs(ty.map)
  }
  if ('object' in ty) {
    return Object.values(ty.object).flatMap(field => collectTypeRefs(field))
  }
  return []
}

/** Collect named type refs from overlay field maps. */
export function collectFieldRefs(
  fields: Record<string, OverlayField> | undefined,
): string[] {
  if (fields === undefined) {
    return []
  }
  return Object.values(fields).flatMap(field => collectTypeRefs(field))
}

/**
 * Names referenced from an overlay definition (base / aliasOf / arrayOf / field refs).
 * Does not include the overlay's own name.
 */
export function collectOverlayDeps(overlay: Overlay): string[] {
  switch (overlay.kind) {
    case 'extendDto':
      return [overlay.base, ...collectFieldRefs(overlay.fields)]
    case 'mapDto':
      return [
        ...(overlay.base !== undefined ? [overlay.base] : []),
        ...collectFieldRefs(overlay.fields),
      ]
    case 'projectUnion':
      return [overlay.base, ...collectFieldRefs(overlay.succeededFields)]
    case 'synthetic': {
      const deps: string[] = []
      if (overlay.aliasOf !== undefined) {
        deps.push(overlay.aliasOf)
      }
      if (overlay.arrayOf !== undefined) {
        deps.push(overlay.arrayOf)
      }
      deps.push(...collectFieldRefs(overlay.fields))
      return deps
    }
  }
}

/**
 * Wire type names synthesized by dto-gen that are not always present as
 * `components.schemas` entries (inline response oneOfs).
 */
export const IR_SYNTHESIZED_TYPE_NAMES = new Set([
  'ProcessPaymentResult',
  'PaymentMethodResult',
])

/**
 * Cross-check operations against the OpenAPI snapshot and the overlay catalog.
 *
 * - Every operation route must exist in the snapshot.
 * - Every request/response DTO ref must resolve to an OpenAPI schema or a defined overlay.
 * - Every string in `operation.overlays` must resolve to a defined overlay or OpenAPI schema.
 * - Every overlay `base` / `aliasOf` / `arrayOf` / field `ref` must resolve similarly
 *   (`aliasOf` may name an IR-synthesized wire type such as `ProcessPaymentResult`).
 * - Overlay definitions that are never referenced from operations or other overlays fail.
 */
export function crossCheckOpenApi(
  manifest: SdkContractManifest,
  snapshot: OpenApiSnapshot,
  options: { irTypeNames?: ReadonlySet<string> } = {},
): string[] {
  const issues: string[] = []
  const paths = snapshot.paths ?? {}
  const schemas = snapshot.components?.schemas ?? {}
  const overlays = manifest.overlays
  const irTypeNames = options.irTypeNames ?? IR_SYNTHESIZED_TYPE_NAMES

  const referencedOverlayNames = new Set<string>()

  const markTypeRef = (owner: string, ref: string): void => {
    if (ref in overlays) {
      referencedOverlayNames.add(ref)
      return
    }
    if (ref in schemas || irTypeNames.has(ref)) {
      return
    }
    issues.push(
      `OpenAPI schema: ${owner} DTO ref "${ref}" not in components.schemas and not a defined overlay`,
    )
  }

  for (const [id, operation] of Object.entries(manifest.operations)) {
    const pathItem = paths[operation.route.path]
    const method = methodKey(operation.route.method)
    if (!pathItem || pathItem[method] === undefined) {
      issues.push(
        `OpenAPI route: operations.${id} ${operation.route.method} ${operation.route.path} not found in snapshot`,
      )
    }

    const refs = [operation.request, operation.response].filter(
      (ref): ref is string => typeof ref === 'string',
    )
    for (const ref of refs) {
      markTypeRef(`operations.${id}`, ref)
    }

    for (const param of operation.params ?? []) {
      for (const ref of collectParamTypeRefs(param)) {
        markTypeRef(`operations.${id}.params.${param.name}`, ref)
      }
    }

    for (const overlayRef of operation.overlays) {
      if (overlayRef in overlays) {
        referencedOverlayNames.add(overlayRef)
        continue
      }
      if (overlayRef in schemas || irTypeNames.has(overlayRef)) {
        continue
      }
      issues.push(
        `Overlay ref: operations.${id} overlays entry "${overlayRef}" is not a defined overlay or OpenAPI schema`,
      )
    }
  }

  for (const [section, entries] of [
    ['topLevel', manifest.topLevel],
    ['facade', manifest.facade],
    ['coreHelpers', manifest.coreHelpers],
  ] as const) {
    for (const [id, entry] of Object.entries(entries)) {
      for (const param of entry.params ?? []) {
        for (const ref of collectParamTypeRefs(param)) {
          markTypeRef(`${section}.${id}.params.${param.name}`, ref)
        }
      }
    }
  }

  for (const [name, overlay] of Object.entries(overlays)) {
    for (const dep of collectOverlayDeps(overlay)) {
      if (dep in overlays) {
        referencedOverlayNames.add(dep)
        continue
      }
      if (dep in schemas || irTypeNames.has(dep)) {
        continue
      }
      issues.push(
        `Overlay base: overlays.${name} references "${dep}" which is not a defined overlay or OpenAPI schema`,
      )
    }
  }

  // Mark transitive overlay deps as referenced so supporting types are not flagged.
  let grew = true
  while (grew) {
    grew = false
    for (const name of [...referencedOverlayNames]) {
      const overlay = overlays[name]
      if (overlay === undefined) {
        continue
      }
      for (const dep of collectOverlayDeps(overlay)) {
        if (dep in overlays && !referencedOverlayNames.has(dep)) {
          referencedOverlayNames.add(dep)
          grew = true
        }
      }
    }
  }

  for (const name of Object.keys(overlays)) {
    if (!referencedOverlayNames.has(name)) {
      issues.push(`Overlay unused: overlays.${name} is never referenced by operations or overlays`)
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
    ...assertParamsCoverage(manifest),
  ]
}
