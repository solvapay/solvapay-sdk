import type { PartialSolvaPayCopy, SolvaPayCopy } from './types'

/**
 * Shallow-per-section merge over the default English bundle. Each top-level
 * section of `SolvaPayCopy` is itself a flat record, so a two-level spread is
 * sufficient — no recursive walk needed.
 */
export function mergeCopy(
  defaults: SolvaPayCopy,
  overrides?: PartialSolvaPayCopy,
): SolvaPayCopy {
  if (!overrides) return defaults

  // Clone defaults, then overlay each overridden section. The assignment uses
  // `unknown` as an intermediate cast because TS widens the section union to
  // the intersection of every section type, which no single record satisfies.
  const merged: SolvaPayCopy = { ...defaults }

  for (const sectionKey of Object.keys(overrides) as Array<keyof SolvaPayCopy>) {
    const defaultSection = defaults[sectionKey] as Record<string, unknown>
    const overrideSection = overrides[sectionKey] as Record<string, unknown> | undefined
    if (!overrideSection) continue
    const combined = { ...defaultSection, ...overrideSection } as unknown
    ;(merged as Record<keyof SolvaPayCopy, unknown>)[sectionKey] = combined
  }

  return merged
}
