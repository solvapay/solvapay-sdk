'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Appearance } from '@stripe/stripe-js'
import { buildStripeAppearance } from './buildStripeAppearance'

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * The elements a host theme switch can land on: every ancestor of the form
 * root, from its parent up to `<html>`. Hosts switch theme with a class
 * (`html.dark`), a data attribute (`[data-theme]`), an inline
 * `color-scheme`, or a wrapper element above the form; all of them are
 * attribute changes on one of these elements.
 *
 * The root itself is left out: the form writes its own `data-*` state on
 * every step, and `buildStripeAppearance` appends a probe child to it.
 */
function themeAncestors(root: Element): Element[] {
  const ancestors: Element[] = []
  for (let node = root.parentElement; node; node = node.parentElement) {
    ancestors.push(node)
  }
  return ancestors
}

/**
 * Resolve the Stripe Elements `appearance` for a form root.
 *
 * - `undefined` (prop omitted) — compute from `--solvapay-*` tokens on `root`.
 * - `null` — restore Stripe's default theme (pass no appearance).
 * - an `Appearance` object — use it as-is.
 *
 * Computation is synchronous once `root` is set so `<Elements>` can mount
 * already themed. Recomputes when `prefers-color-scheme` flips or when an
 * attribute changes on any ancestor of the root, which is how hosts switch
 * theme (`class="dark"`, `data-theme`, inline `color-scheme` or theme vars).
 * The appearance object only changes when the resolved values do.
 */
export function useStripeAppearance(
  root: Element | null,
  appearance?: Appearance | null,
): Appearance | undefined {
  const [themeTick, setThemeTick] = useState(0)
  const lastBuilt = useRef<string | undefined>(undefined)

  useIsomorphicLayoutEffect(() => {
    if (appearance !== undefined) return
    if (!root) return

    // One rebuild per frame, however many mutations land in it: an animated
    // drawer or modal above the form rewrites its `style` every frame.
    let frame: number | undefined
    const rebuild = () => {
      frame = undefined
      const next = JSON.stringify(buildStripeAppearance(root) ?? null)
      if (next === lastBuilt.current) return
      setThemeTick(tick => tick + 1)
    }
    const apply = () => {
      if (frame === undefined) frame = requestAnimationFrame(rebuild)
    }

    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : undefined
    media?.addEventListener('change', apply)

    const observer = new MutationObserver(apply)
    for (const ancestor of themeAncestors(root)) {
      observer.observe(ancestor, { attributes: true })
    }

    return () => {
      media?.removeEventListener('change', apply)
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [root, appearance])

  return useMemo(() => {
    if (appearance === null) return undefined
    if (appearance !== undefined) return appearance
    if (!root) return undefined
    const built = buildStripeAppearance(root)
    lastBuilt.current = JSON.stringify(built ?? null)
    return built
  }, [root, appearance, themeTick])
}
