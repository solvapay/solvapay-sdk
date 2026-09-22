/**
 * Buyer-facing tax-summary copy constants (DEV-723).
 *
 * Resolver functions live in `native-core.ts`. These strings stay here so
 * React can re-export them as values without calling the native binding at
 * module load.
 */

export const REVERSE_CHARGE_NOTE =
  'VAT reverse charge applies — you are responsible for reporting VAT in your jurisdiction.'

export const TAX_NOT_COLLECTED_NOTE = 'Tax is not collected on this purchase.'
