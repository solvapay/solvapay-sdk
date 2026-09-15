/**
 * Assert manifest `names:` / `nameOverrides:` for hand-written facade and
 * top-level symbols exist in the Python, Ruby, Go, Rust, and C surfaces.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Language, SdkContractManifest } from '../../shared/manifest-schema.js'
import { sdkPath } from '../../shared/repo-paths.js'
import type { ParityIssue } from './parity.js'

const SURFACE_SOURCES: Record<Exclude<Language, 'ts'>, readonly string[]> = {
  py: [
    path.join(sdkPath('python'), 'python/solvapay/facade.py'),
    path.join(sdkPath('python'), 'python/solvapay/errors.py'),
    path.join(sdkPath('python'), 'python/solvapay/__init__.py'),
    path.join(sdkPath('python'), 'python/solvapay/retry.py'),
  ],
  rb: [
    path.join(sdkPath('ruby'), 'lib/solvapay/facade.rb'),
    path.join(sdkPath('ruby'), 'lib/solvapay.rb'),
    path.join(sdkPath('ruby'), 'lib/solvapay/errors.rb'),
    path.join(sdkPath('ruby'), 'lib/solvapay/helpers.rb'),
  ],
  go: [
    path.join(sdkPath('go'), 'solvapay.go'),
    path.join(sdkPath('go'), 'gate.go'),
    path.join(sdkPath('go'), 'errors.go'),
    path.join(sdkPath('go'), 'retry.go'),
  ],
  rust: [
    path.join(sdkPath('rust'), 'src/client.rs'),
    path.join(sdkPath('rust'), 'src/lib.rs'),
    path.join(sdkPath('rust'), 'src/gate.rs'),
    path.join(sdkPath('rust'), 'src/blocking.rs'),
    path.join(sdkPath('rust'), 'src/retry.rs'),
  ],
  c: [path.join(sdkPath('capi'), 'src/lib.rs'), path.join(sdkPath('capi'), 'include/solvapay.h')],
}

const FACADE_LANGS = ['py', 'rb', 'go', 'rust', 'c'] as const

function leafName(symbol: string): string {
  const parts = symbol.split(/::|\./)
  const last = parts[parts.length - 1]
  if (last === undefined || last.trim() === '') {
    throw new Error(`empty leaf name in symbol ${symbol}`)
  }
  return last.trim()
}

function sourcesFor(lang: Exclude<Language, 'ts'>): string {
  return SURFACE_SOURCES[lang]
    .map(rel => {
      try {
        return readFileSync(rel, 'utf8')
      } catch {
        return ''
      }
    })
    .join('\n')
}

function catalogEntry(
  manifest: SdkContractManifest,
  id: string,
):
  | {
      names: Record<Language, string>
      availability?: SdkContractManifest['facade'][string]['availability']
    }
  | undefined {
  return manifest.facade[id] ?? manifest.topLevel[id]
}

function omitted(manifest: SdkContractManifest, id: string, lang: Language): boolean {
  const entry = catalogEntry(manifest, id)
  const avail = entry?.availability?.[lang]
  return avail !== undefined && 'omitted' in avail && avail.omitted === true
}

function isHandWrittenCatalog(entry: {
  availability?: Record<string, { handWritten?: boolean; omitted?: boolean }>
}): boolean {
  const avail = entry.availability
  if (avail === undefined) return false
  return Object.values(avail).some(item => item.handWritten === true || item.omitted === true)
}

function collectSymbols(
  manifest: SdkContractManifest,
): Array<{ id: string; lang: Language; name: string }> {
  const handwrittenIds = new Set(Object.keys(manifest.facade ?? {}))
  for (const [id, entry] of Object.entries(manifest.topLevel ?? {})) {
    if (isHandWrittenCatalog(entry)) handwrittenIds.add(id)
  }
  const out: Array<{ id: string; lang: Language; name: string }> = []
  for (const id of handwrittenIds) {
    const entry = catalogEntry(manifest, id)
    if (entry === undefined) continue
    for (const lang of FACADE_LANGS) {
      const name = entry.names[lang]
      if (name === undefined || name === '') continue
      out.push({ id, lang, name })
    }
  }
  for (const [id, overrides] of Object.entries(manifest.nameOverrides ?? {})) {
    if (!handwrittenIds.has(id)) continue
    for (const lang of FACADE_LANGS) {
      const name = overrides[lang]
      if (name === undefined) continue
      out.push({ id, lang, name })
    }
  }
  return out
}

export function checkHandwrittenFacadeNames(manifest: SdkContractManifest): ParityIssue[] {
  const cache = new Map<Exclude<Language, 'ts'>, string>()
  const issues: ParityIssue[] = []
  const seen = new Set<string>()
  for (const item of collectSymbols(manifest)) {
    if (item.lang === 'ts') continue
    if (omitted(manifest, item.id, item.lang)) continue
    const key = `${item.id}:${item.lang}:${item.name}`
    if (seen.has(key)) continue
    seen.add(key)
    const lang = item.lang
    let text = cache.get(lang)
    if (text === undefined) {
      text = sourcesFor(lang)
      cache.set(lang, text)
    }
    const leaf = leafName(item.name)
    const re = new RegExp(`\\b${leaf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    if (!re.test(text)) {
      issues.push({
        kind: 'missing',
        message: `hand-written name ${item.id}.${item.lang} "${item.name}" (leaf ${leaf}) is not present in the ${lang} surface`,
      })
    }
  }
  return issues
}
