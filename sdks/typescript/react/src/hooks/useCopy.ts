import { useCopyContext } from '../i18n/context'
import type { SolvaPayCopy } from '../i18n/types'

/**
 * Read the merged copy bundle from context. Used by every SDK component that
 * renders user-visible strings; consumers rarely call it directly but it's
 * exported as an escape hatch for custom UIs.
 */
export function useCopy(): SolvaPayCopy {
  return useCopyContext().copy
}

/**
 * Current locale string (e.g. `'en'`, `'sv-SE'`). Used to thread the locale
 * through `Intl.NumberFormat`, `Intl.DateTimeFormat`, and Stripe Elements.
 * `undefined` means "runtime default".
 */
export function useLocale(): string | undefined {
  return useCopyContext().locale
}
