'use client'

/**
 * `useHostLocale()` — mirror the host's active BCP-47 locale.
 *
 * Per the MCP Apps bridge spec (OpenAI Apps SDK "Build your ChatGPT UI",
 * locale section), the host writes the current locale into
 * `document.documentElement.lang` on every mount and updates it
 * whenever the user switches language mid-session. Widgets that want
 * locale-aware formatting (`Intl.NumberFormat`, `Intl.DateTimeFormat`,
 * Stripe Elements) read from there.
 *
 * The hook:
 *   - returns `documentElement.lang` when set,
 *   - falls back to `navigator.language`, then `'en-US'`,
 *   - subscribes via `MutationObserver` so mid-session switches
 *     propagate without a remount,
 *   - disconnects the observer on unmount.
 *
 * Pair with `formatPrice({ locale })` / `Intl.DateTimeFormat(locale, …)`
 * in MCP views. Intentionally narrow: it does not translate strings —
 * that's the copy bundle's job (`useLocale()` from `@solvapay/react`).
 */

import { useEffect, useState } from 'react'

const FALLBACK_LOCALE = 'en-US'

function resolveLocale(): string {
  if (typeof document !== 'undefined') {
    const lang = document.documentElement?.lang
    if (lang) return lang
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language
  }
  return FALLBACK_LOCALE
}

export function useHostLocale(): string {
  const [locale, setLocale] = useState<string>(() => resolveLocale())

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
      return
    }
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setLocale((prev) => {
        const next = resolveLocale()
        return next === prev ? prev : next
      })
    })
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] })
    // Sync once in case `lang` changed between mount and effect.
    setLocale((prev) => {
      const next = resolveLocale()
      return next === prev ? prev : next
    })
    return () => {
      observer.disconnect()
    }
  }, [])

  return locale
}
