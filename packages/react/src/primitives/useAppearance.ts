'use client'

import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { Appearance } from '../types/appearance'
import { buildAppearance } from './buildAppearance'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * Resolve the card-field `appearance` for a form root.
 *
 * - `undefined` (prop omitted) — compute from `--solvapay-*` tokens on `root`.
 * - `null` — use the SDK's stock field look (no appearance).
 * - an `Appearance` object — use it as-is.
 *
 * Computation is synchronous once `root` is set so the card fields mount
 * already themed. Recomputes when `prefers-color-scheme` flips or when
 * something writes theme vars onto `document.documentElement`.
 */
export function useAppearance(
  root: Element | null,
  appearance?: Appearance | null,
): Appearance | undefined {
  const [themeTick, setThemeTick] = useState(0)

  useIsomorphicLayoutEffect(() => {
    if (appearance !== undefined) return
    if (!root) return

    const apply = () => setThemeTick(tick => tick + 1)

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : undefined
    media?.addEventListener('change', apply)

    const observer = new MutationObserver(apply)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style'],
    })

    return () => {
      media?.removeEventListener('change', apply)
      observer.disconnect()
    }
  }, [root, appearance])

  return useMemo(() => {
    if (appearance === null) return undefined
    if (appearance !== undefined) return appearance
    if (!root) return undefined
    return buildAppearance(root)
    // themeTick is a deliberate extra dependency: the root's computed styles
    // are re-read when the theme changes.
  }, [root, appearance, themeTick])
}
