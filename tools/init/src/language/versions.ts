import type { ScaffoldLanguage } from './ids'

export type LanguageDep = {
  name: string
  fallback: string
}

export const LANGUAGE_RUNTIME_DEPS: Record<ScaffoldLanguage, readonly LanguageDep[]> = {
  ts: [
    { name: '@solvapay/mcp', fallback: '0.3.0' },
    { name: '@solvapay/server', fallback: '1.1.0' },
    { name: '@solvapay/react', fallback: '1.2.0' },
  ],
  python: [
    { name: 'solvapay', fallback: '0.1.0' },
    { name: 'solvapay-mcp', fallback: '0.1.0' },
  ],
  ruby: [
    { name: 'solvapay', fallback: '0.1.0' },
    { name: 'solvapay-mcp', fallback: '0.1.0' },
  ],
  go: [{ name: 'github.com/solvapay/solvapay-go', fallback: 'v0.1.0' }],
  rust: [
    { name: 'solvapay', fallback: '0.1.0' },
    { name: 'solvapay-mcp', fallback: '0.1.0' },
  ],
}

export type ResolveLatestVersionsOptions = {
  timeoutMs?: number
  onResolve?: (entry: { name: string; version: string; source: 'registry' | 'fallback' }) => void
}

const DEFAULT_TIMEOUT_MS = 3000

const defaultOnResolve = (entry: {
  name: string
  version: string
  source: 'registry' | 'fallback'
}): void => {
  const suffix = entry.source === 'fallback' ? ' (offline fallback)' : ''
  process.stdout.write(`   ${entry.name}@${entry.version}${suffix}\n`)
}

const registryUrl = (language: ScaffoldLanguage, name: string): string => {
  switch (language) {
    case 'ts':
      return `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`
    case 'python':
      return `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
    case 'ruby':
      return `https://rubygems.org/api/v1/gems/${encodeURIComponent(name)}.json`
    case 'go':
      return `https://proxy.golang.org/${name}/@latest`
    case 'rust':
      return `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`
  }
}

const parseVersion = (language: ScaffoldLanguage, body: unknown): string | undefined => {
  if (!body || typeof body !== 'object') return undefined
  const record = body as Record<string, unknown>
  if (language === 'ts') {
    return typeof record.version === 'string' && record.version.length > 0
      ? record.version
      : undefined
  }
  if (language === 'python') {
    const info = record.info
    if (!info || typeof info !== 'object') return undefined
    const version = (info as { version?: unknown }).version
    return typeof version === 'string' && version.length > 0 ? version : undefined
  }
  if (language === 'ruby' || language === 'go') {
    const version = record.version ?? record.Version
    return typeof version === 'string' && version.length > 0 ? version : undefined
  }
  const crate = record.crate
  if (!crate || typeof crate !== 'object') return undefined
  const crateRecord = crate as { max_stable_version?: unknown; max_version?: unknown }
  if (typeof crateRecord.max_stable_version === 'string' && crateRecord.max_stable_version) {
    return crateRecord.max_stable_version
  }
  if (typeof crateRecord.max_version === 'string' && crateRecord.max_version) {
    return crateRecord.max_version
  }
  return undefined
}

/**
 * Resolve current published versions for the language's SolvaPay packages.
 * Registry failures fall back to the hardcoded pin so offline scaffolds still
 * produce an installable manifest.
 */
export async function resolveLatestVersions(
  language: ScaffoldLanguage,
  deps: ReadonlyArray<LanguageDep> = LANGUAGE_RUNTIME_DEPS[language],
  options: ResolveLatestVersionsOptions = {},
): Promise<Map<string, string>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const onResolve = options.onResolve ?? defaultOnResolve

  const settled = await Promise.all(
    deps.map(async dep => {
      try {
        const response = await fetch(registryUrl(language, dep.name), {
          headers: {
            accept: 'application/json',
            'user-agent': 'solvapay-init (https://github.com/solvapay/solvapay-sdk)',
          },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) {
          return { dep, version: dep.fallback, source: 'fallback' as const }
        }
        const body: unknown = await response.json()
        const version = parseVersion(language, body)
        if (!version) {
          return { dep, version: dep.fallback, source: 'fallback' as const }
        }
        return { dep, version, source: 'registry' as const }
      } catch {
        return { dep, version: dep.fallback, source: 'fallback' as const }
      }
    }),
  )

  const result = new Map<string, string>()
  for (const entry of settled) {
    result.set(entry.dep.name, entry.version)
    onResolve({ name: entry.dep.name, version: entry.version, source: entry.source })
  }
  return result
}

/** @deprecated Prefer {@link resolveLatestVersions}('ts'). Kept for TS scaffold call sites. */
export async function resolveLatestSolvapayVersions(
  deps: ReadonlyArray<LanguageDep> = LANGUAGE_RUNTIME_DEPS.ts,
  options: ResolveLatestVersionsOptions = {},
): Promise<Map<string, string>> {
  return resolveLatestVersions('ts', deps, options)
}
