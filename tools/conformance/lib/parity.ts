/**
 * Manifest-driven export parity / coverage check (§2.7 / step 18).
 *
 * Language-agnostic catalog loading + reporting; TS surface reading is injected
 * so Python/Ruby/Go/Rust checks can reuse the same core later.
 */

import type {
  EntryAvailability,
  Language,
  SdkContractManifest,
} from '../../shared/manifest-schema.js'
import { LANGUAGES } from '../../shared/manifest-schema.js'

export type CatalogSection = 'operations' | 'topLevel' | 'coreHelpers' | 'facade' | 'mcp'

export interface CataloguedEntry {
  section: CatalogSection
  id: string
  /** Idiomatic TypeScript export / method name. */
  tsName: string
  /**
   * Where the symbol is expected on the TypeScript surface.
   * - `export` — named export from a package entry
   * - `clientMethod` — method on `SolvaPayClient`
   * - `facadeMethod` — method on `SolvaPay` (createSolvaPay return)
   */
  surface: 'export' | 'clientMethod' | 'facadeMethod'
}

export interface ExportMap {
  /** Package or module label (for messages). */
  label: string
  /** Named export identifiers. */
  exports: Set<string>
}

export interface ParityIssue {
  kind: 'missing' | 'extra' | 'casing'
  message: string
}

/**
 * §2.5 TypeScript-only framework glue — portable-surface parity must not
 * require these symbols on other languages. Listed explicitly; never skipped
 * silently when checking the TS surface for *extra* exports.
 */
export const TS_ONLY_ALLOWLIST: readonly string[] = [
  // packages/server adapters + fetch + MCP registration
  'NextAdapter',
  'HttpAdapter',
  'McpAdapter',
  'Adapter',
  'createVirtualTools',
  'verifyProductConfiguration',
  'VIRTUAL_TOOL_DEFINITIONS',
  'registerVirtualToolsMcp',
  'registerVirtualToolsMcpImpl',
  'jsonSchemaToZodRawShape',
  'isPaywallStructuredContent',
  // fetch route handlers
  'createCheckoutHandler',
  'createCustomerHandler',
  'createWebhookHandler',
  'createSolvapayWebhookHandler',
  'jsonResponse',
  'errorResponse',
  // TS route-helper cores (framework-agnostic but not cross-language catalogued)
  'getAuthenticatedUserCore',
  'syncCustomerCore',
  'getCustomerBalanceCore',
  'createPaymentIntentCore',
  'createTopupPaymentIntentCore',
  'processPaymentIntentCore',
  'processTopupPaymentIntentCore',
  'attachBusinessDetailsCore',
  'createCheckoutSessionCore',
  'createCustomerSessionCore',
  'cancelPurchaseCore',
  'reactivatePurchaseCore',
  'activatePlanCore',
  'getPaymentMethodCore',
  'getAutoRechargeCore',
  'saveAutoRechargeCore',
  'disableAutoRechargeCore',
  'checkPurchaseCore',
  'trackUsageCore',
  'getUsageCore',
  'listPlansCore',
  'checkLimitsCore',
  'getMerchantCore',
  'getProductCore',
  'handleRouteError',
  'pollBalanceUntilIncreased',
  'BALANCE_RECONCILE_DELAYS_MS',
  'TOPUP_BALANCE_POLL_DELAYS_MS',
  // Pure helper decision cores (classifyCancelError, selectActivePurchases,
  // validate*Params, …) are recognized via derived binding names.ts — not
  // allowlisted here. Adding a #[solvapay_export] symbol is sufficient for parity.
  // core package config / domain helpers (not in cross-language catalog)
  'getSellerTaxIdentifierDisplayLabelByType',
  'getSolvaPayConfig',
  'installNativeCoreApi',
  'resetNativeCoreApiForTests',
  'isRenewalError',
  'Env',
  'version',
  // OpenAPI namespace re-export
  'components',
  // @internal native / WASM seams re-exported from @solvapay/server:
  // fixture harness + package installs. Not part of the portable
  // cross-language surface.
  'callNativeSync',
  'nativeBuildInfo',
  'loadWasmBinding',
  'getWasmClient',
  'setWasmClientForTests',
  'resetWasmCache',
] as const

/** Suffix / pattern allowlist for TS-only supporting exports. */
export function isTsOnlyAllowlisted(
  name: string,
  explicit: ReadonlySet<string> = new Set(TS_ONLY_ALLOWLIST),
): boolean {
  if (explicit.has(name)) {
    return true
  }
  // Route helper cores and adapter option types
  if (name.endsWith('Core') || name.endsWith('Adapter') || name.endsWith('AdapterOptions')) {
    return true
  }
  return false
}

/** Build the catalogued TS entry list from a parsed manifest. */
export function cataloguedTsEntries(manifest: SdkContractManifest): CataloguedEntry[] {
  const out: CataloguedEntry[] = []

  for (const [id, entry] of Object.entries(manifest.operations)) {
    out.push({
      section: 'operations',
      id,
      tsName: entry.names.ts,
      surface: 'clientMethod',
    })
  }
  for (const [id, entry] of Object.entries(manifest.topLevel)) {
    out.push({
      section: 'topLevel',
      id,
      tsName: entry.names.ts.includes('.') ? entry.names.ts.split('.').pop()! : entry.names.ts,
      surface: 'export',
    })
  }
  for (const [id, entry] of Object.entries(manifest.coreHelpers)) {
    out.push({
      section: 'coreHelpers',
      id,
      tsName: entry.names.ts,
      surface: 'export',
    })
  }
  for (const [id, entry] of Object.entries(manifest.facade)) {
    const tsName = entry.names.ts.includes('.') ? entry.names.ts.split('.').pop()! : entry.names.ts
    const surface =
      id === 'createSolvaPay' || id === 'createSolvaPayClient' ? 'export' : 'facadeMethod'
    out.push({
      section: 'facade',
      id,
      tsName,
      surface,
    })
  }

  return out
}

export interface CheckParityInput {
  manifest: SdkContractManifest
  /** Combined named exports from portable packages (@solvapay/server + @solvapay/core). */
  portableExports: Set<string>
  /** Method names present on SolvaPayClient (required + optional). */
  clientMethods: Set<string>
  /** Method names present on SolvaPay facade (payable / protect / gate). */
  facadeMethods?: Set<string>
  /** Extra binding `names.ts` from `binding-symbols.snapshot.json`. */
  derivedBindings?: Record<string, { names: { ts: string } }>
  /** Override the §2.5 TS-only allowlist (tests). */
  allowlist?: readonly string[]
}

export interface CataloguedMcpEntry {
  section: 'mcp'
  id: string
  lang: Language
  name: string
  surface: 'syncOp' | 'layer2'
}

export interface McpLanguageSurface {
  symbols: Set<string>
  hasCallEnvelope: boolean
}

/** True when the language is a declared skip (`omitted` or `handWritten`). */
export function isDeclaredLanguageSkip(
  availability: Partial<Record<Language, EntryAvailability>> | undefined,
  lang: Language,
): { skip: boolean; emptyReason: boolean } {
  const declared = availability?.[lang]
  if (declared === undefined) {
    return { skip: false, emptyReason: false }
  }
  const emptyReason = declared.reason.trim() === ''
  if ('omitted' in declared && declared.omitted === true) {
    return { skip: true, emptyReason }
  }
  if ('handWritten' in declared && declared.handWritten === true) {
    return { skip: true, emptyReason }
  }
  return { skip: false, emptyReason: false }
}

/** One expected MCP name per language, skipping declared availability exclusions. */
export function cataloguedMcpEntries(manifest: SdkContractManifest): CataloguedMcpEntry[] {
  const out: CataloguedMcpEntry[] = []
  for (const [id, entry] of Object.entries(manifest.mcp ?? {})) {
    for (const lang of LANGUAGES) {
      if (isDeclaredLanguageSkip(entry.availability, lang).skip) {
        continue
      }
      out.push({
        section: 'mcp',
        id,
        lang,
        name: entry.names[lang],
        surface: entry.surface,
      })
    }
  }
  return out
}

export interface CataloguedHelperEntry {
  section: 'topLevel' | 'coreHelpers'
  id: string
  lang: Language
  name: string
}

/** One expected helper name per language, skipping declared availability exclusions. */
export function cataloguedHelperEntries(manifest: SdkContractManifest): CataloguedHelperEntry[] {
  const out: CataloguedHelperEntry[] = []
  const sections = [
    ['topLevel', manifest.topLevel] as const,
    ['coreHelpers', manifest.coreHelpers] as const,
  ]
  for (const [section, entries] of sections) {
    for (const [id, entry] of Object.entries(entries)) {
      for (const lang of LANGUAGES) {
        if (lang === 'c') {
          continue
        }
        if (isDeclaredLanguageSkip(entry.availability, lang).skip) {
          continue
        }
        out.push({
          section,
          id,
          lang,
          name: entry.names[lang],
        })
      }
    }
  }
  return out
}

export function checkHelperParity(
  manifest: SdkContractManifest,
  surfaces: Partial<Record<Exclude<Language, 'c'>, Set<string>>>,
): ParityIssue[] {
  const issues: ParityIssue[] = []
  for (const entry of cataloguedHelperEntries(manifest)) {
    const symbols = surfaces[entry.lang] ?? new Set<string>()
    if (symbols.has(entry.name)) {
      continue
    }
    const lower = entry.name.toLowerCase()
    const found = [...symbols].find(name => name.toLowerCase() === lower)
    if (found !== undefined) {
      issues.push({
        kind: 'casing',
        message: `Casing: ${entry.section}.${entry.id} expected ${entry.lang} name "${entry.name}", found "${found}"`,
      })
    } else {
      issues.push({
        kind: 'missing',
        message: `Missing: ${entry.section}.${entry.id} ${entry.lang} helper "${entry.name}" not on the ${entry.lang} helper surface`,
      })
    }
  }
  return issues
}

export function checkMcpParity(
  manifest: SdkContractManifest,
  surfaces: Partial<Record<Language, McpLanguageSurface>>,
  bindings?: Record<string, { section?: string }>,
): ParityIssue[] {
  const issues: ParityIssue[] = []

  for (const [id, entry] of Object.entries(manifest.mcp ?? {})) {
    for (const lang of LANGUAGES) {
      const exclusion = isDeclaredLanguageSkip(entry.availability, lang)
      if (exclusion.skip) {
        if (exclusion.emptyReason) {
          issues.push({
            kind: 'missing',
            message: `Omission: mcp.${id}.${lang} is omitted without a reason`,
          })
        }
        continue
      }
      const surface = surfaces[lang]
      const expected = entry.names[lang]
      if (entry.surface === 'syncOp' && surface?.hasCallEnvelope === true) {
        continue
      }
      const symbols = surface?.symbols ?? new Set<string>()
      if (symbols.has(expected)) {
        continue
      }
      const lower = expected.toLowerCase()
      const found = [...symbols].find(name => name.toLowerCase() === lower)
      if (found !== undefined) {
        issues.push({
          kind: 'casing',
          message: `Casing: mcp.${id} expected ${lang} name "${expected}", found "${found}"`,
        })
      } else {
        issues.push({
          kind: 'missing',
          message: `Missing: mcp.${id} ${lang} symbol "${expected}" not on the ${lang} MCP surface`,
        })
      }
    }
  }

  if (bindings !== undefined) {
    const catalogued = new Set(Object.keys(manifest.mcp ?? {}))
    for (const [id, symbol] of Object.entries(bindings)) {
      if (symbol.section !== 'MCP payload / descriptors') {
        continue
      }
      if (!catalogued.has(id)) {
        issues.push({
          kind: 'extra',
          message: `Missing: layer-2 binding "${id}" is not in the mcp catalog section`,
        })
      }
    }
  }

  return issues
}

/**
 * Compare catalogued entry points against a synthetic or real export map.
 */
export function checkParity(input: CheckParityInput): ParityIssue[] {
  const allowlist = new Set(input.allowlist ?? TS_ONLY_ALLOWLIST)
  const catalog = cataloguedTsEntries(input.manifest)
  const issues: ParityIssue[] = []

  const expectedExports = new Set<string>()
  const facadeMethods = input.facadeMethods ?? new Set<string>()
  // §5.7 cross-language helpers (catalog.kind: none and linked bindings).
  // Recognition-only: suppress "extra", do not require presence (some payload
  // builders are internal and not TS exports).
  const bindingTsNames = new Set(
    Object.values(input.derivedBindings ?? {}).map(symbol => symbol.names.ts),
  )

  for (const entry of catalog) {
    if (entry.surface === 'clientMethod') {
      if (!input.clientMethods.has(entry.tsName)) {
        const lower = entry.tsName.toLowerCase()
        const found = [...input.clientMethods].find(m => m.toLowerCase() === lower)
        if (found !== undefined && found !== entry.tsName) {
          issues.push({
            kind: 'casing',
            message: `Casing: operations.${entry.id} expected client method "${entry.tsName}", found "${found}"`,
          })
        } else {
          issues.push({
            kind: 'missing',
            message: `Missing: operations.${entry.id} client method "${entry.tsName}" not on SolvaPayClient`,
          })
        }
      }
    } else if (entry.surface === 'facadeMethod') {
      if (!facadeMethods.has(entry.tsName)) {
        const lower = entry.tsName.toLowerCase()
        const found = [...facadeMethods].find(m => m.toLowerCase() === lower)
        if (found !== undefined && found !== entry.tsName) {
          issues.push({
            kind: 'casing',
            message: `Casing: facade.${entry.id} expected method "${entry.tsName}", found "${found}"`,
          })
        } else {
          issues.push({
            kind: 'missing',
            message: `Missing: facade.${entry.id} method "${entry.tsName}" not on SolvaPay`,
          })
        }
      }
    } else {
      expectedExports.add(entry.tsName)
      if (!input.portableExports.has(entry.tsName)) {
        const lower = entry.tsName.toLowerCase()
        const found = [...input.portableExports].find(e => e.toLowerCase() === lower)
        if (found !== undefined && found !== entry.tsName) {
          issues.push({
            kind: 'casing',
            message: `Casing: ${entry.section}.${entry.id} expected export "${entry.tsName}", found "${found}"`,
          })
        } else {
          issues.push({
            kind: 'missing',
            message: `Missing: ${entry.section}.${entry.id} export "${entry.tsName}" not in portable surface`,
          })
        }
      }
    }
  }

  for (const name of input.portableExports) {
    if (
      expectedExports.has(name) ||
      bindingTsNames.has(name) ||
      isTsOnlyAllowlisted(name, allowlist)
    ) {
      continue
    }
    // Types / interfaces / constants that are supporting surface are often
    // exported alongside helpers. Only flag camelCase callables / PascalCase
    // classes that look like public API entry points not in the catalog.
    if (!looksLikePortableEntry(name)) {
      continue
    }
    issues.push({
      kind: 'extra',
      message: `Extra: uncatalogued portable export "${name}" (add a #[solvapay_export] symbol or TS_ONLY_ALLOWLIST)`,
    })
  }

  return issues
}

/**
 * Heuristic for uncatalogued *callable* extras.
 * PascalCase names are treated as types/classes (DTO surface) and ignored here —
 * catalogued classes like `SolvaPayError` are already checked via presence.
 * ALL_CAPS constants are ignored (coreHelpers covers the catalogued ones).
 */
function looksLikePortableEntry(name: string): boolean {
  return /^[a-z][a-zA-Z0-9]*$/.test(name)
}

export function formatParityReport(issues: ParityIssue[]): string {
  if (issues.length === 0) {
    return 'Parity check passed (catalogued entry points present; no uncatalogued portable exports)'
  }
  return ['Parity check failed:', ...issues.map(i => `  - ${i.message}`)].join('\n')
}
