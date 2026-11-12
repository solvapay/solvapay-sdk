import type { ScaffoldLanguage } from './ids'
import { RELEASE_TRAIN_VERSION } from './release-train-version.generated'

export type LanguageDep = {
  name: string
  /** The version this release ships with. Used only with `offline`. */
  pin: string
}

/**
 * Release-train pin for `--offline` scaffolds.
 *
 * The literal lives in `release-train-version.generated.ts`, stamped by
 * `readReleaseTrainVersion` via `tools/repo/sync-release-train.ts`. The
 * published `@solvapay/init` bundle does not ship the monorepo sentinel, so
 * this constant is the copy that travels with the CLI. An empty stamp throws
 * here; a stamp that disagrees with the sentinel fails `pnpm checks:release-train`.
 */
function scaffoldReleaseTrainVersion(): string {
  if (RELEASE_TRAIN_VERSION.length === 0) {
    throw new Error(
      'release-train: init scaffold pins are missing a sentinel version. Run `pnpm exec tsx tools/repo/sync-release-train.ts`.',
    )
  }
  return RELEASE_TRAIN_VERSION
}

const releaseTrainVersion = scaffoldReleaseTrainVersion()

function dep(name: string, version = releaseTrainVersion): LanguageDep {
  return { name, pin: version }
}

export const LANGUAGE_RUNTIME_DEPS: Record<ScaffoldLanguage, readonly LanguageDep[]> = {
  ts: [
    dep('@solvapay/mcp'),
    dep('@solvapay/server'),
    dep('@solvapay/react'),
    dep('@solvapay/core'),
    dep('@solvapay/server-wasm'),
  ],
  python: [dep('solvapay'), dep('solvapay-mcp')],
  ruby: [dep('solvapay'), dep('solvapay-mcp')],
  // Go module versions require a leading `v`. Same sentinel, not a second pin.
  go: [dep('github.com/solvapay/solvapay-sdk/sdks/go', `v${releaseTrainVersion}`)],
  rust: [dep('solvapay'), dep('solvapay-mcp')],
}

export type ResolveLatestVersionsOptions = {
  /**
   * Pin each package to the version this release ships with (the
   * release-train pin) instead of asking the registry. Nothing touches the
   * network. This is `--offline` on the scaffolder.
   */
  offline?: boolean
  /** Per-package timeout in milliseconds. Defaults to 10000ms. */
  timeoutMs?: number
  onResolve?: (entry: {
    name: string
    version: string
    source: 'registry' | 'release-train'
  }) => void
}

const DEFAULT_TIMEOUT_MS = 10_000

const defaultOnResolve = (entry: {
  name: string
  version: string
  source: 'registry' | 'release-train'
}): void => {
  const suffix = entry.source === 'release-train' ? ' (--offline: release pin)' : ''
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
 * The version each package should be pinned to: the registry's latest, or
 * with `offline` the release-train pin.
 *
 * A registry lookup that fails (network error, timeout, non-2xx response,
 * missing version) stops the scaffold with an error naming each package and
 * why. It never falls back quietly: a quiet fallback is how scaffolds ended
 * up weeks behind the SDK, or pinned a package that is published nowhere.
 */
export async function resolveLatestVersions(
  language: ScaffoldLanguage,
  deps: ReadonlyArray<LanguageDep> = LANGUAGE_RUNTIME_DEPS[language],
  options: ResolveLatestVersionsOptions = {},
): Promise<Map<string, string>> {
  const onResolve = options.onResolve ?? defaultOnResolve

  if (options.offline) {
    const pins = new Map<string, string>()
    for (const entry of deps) {
      pins.set(entry.name, entry.pin)
      onResolve({ name: entry.name, version: entry.pin, source: 'release-train' })
    }
    return pins
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const settled = await Promise.all(
    deps.map(async entry => {
      const url = registryUrl(language, entry.name)
      try {
        const response = await fetch(url, {
          headers: {
            accept: 'application/json',
            'user-agent': 'solvapay-init (https://github.com/solvapay/solvapay-sdk)',
          },
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.status === 404) {
          return { name: entry.name, error: `not published (${url} answered 404)` }
        }
        if (!response.ok) return { name: entry.name, error: `${url} answered ${response.status}` }
        const version = parseVersion(language, await response.json())
        if (!version) return { name: entry.name, error: `${url} returned no version` }
        return { name: entry.name, version }
      } catch (error) {
        return {
          name: entry.name,
          error: `${url} failed: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }),
  )

  const failed = settled.filter(
    (entry): entry is { name: string; error: string } => 'error' in entry,
  )
  if (failed.length > 0) {
    throw new Error(
      `Could not resolve the latest SolvaPay ${language} package versions:\n` +
        failed.map(entry => `  - ${entry.name}: ${entry.error}`).join('\n') +
        '\nCheck your network or registry access. Pass --offline to pin the versions this release ships with, ' +
        'or scaffold with --dev to depend on a local solvapay-sdk checkout.',
    )
  }

  const result = new Map<string, string>()
  for (const entry of settled as { name: string; version: string }[]) {
    result.set(entry.name, entry.version)
    onResolve({ name: entry.name, version: entry.version, source: 'registry' })
  }
  return result
}

/** TypeScript shorthand for {@link resolveLatestVersions}('ts'). */
export async function resolveLatestSolvapayVersions(
  deps: ReadonlyArray<LanguageDep> = LANGUAGE_RUNTIME_DEPS.ts,
  options: ResolveLatestVersionsOptions = {},
): Promise<Map<string, string>> {
  return resolveLatestVersions('ts', deps, options)
}
