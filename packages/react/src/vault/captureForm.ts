/**
 * Framework-neutral wrapper around the vault's capture form.
 *
 * Everything vendor-shaped stops here. Above this file the surface is
 * described entirely in the contracts from `./types`, so the React layer, the
 * tests and any future host all see the same normalised state.
 */

import {
  CaptureError,
  type CaptureFieldName,
  type CaptureFieldOptions,
  type CaptureFieldState,
  type CaptureSession,
  type CaptureState,
  type CapturedInstrument,
  type CardBrand,
  type InstrumentDescriptors,
  emptyCaptureState,
  isComplete,
  isReady,
  isSessionUsable,
} from './types'
import {
  loadVaultScript,
  type VaultCollectGlobal,
  type VaultFieldHandle,
  type VaultFormHandle,
  type VaultScriptConfig,
} from './loadVaultScript'

/** Vendor field names, which do not match ours and should not leak upward. */
const VENDOR_FIELD_NAME: Record<CaptureFieldName, string> = {
  cardNumber: 'card_number',
  expiry: 'card_expirationDate',
  cvc: 'card_cvc',
  cardholderName: 'card_holderName',
}

const OUR_FIELD_NAME: Record<string, CaptureFieldName> = Object.fromEntries(
  Object.entries(VENDOR_FIELD_NAME).map(([ours, theirs]) => [theirs, ours as CaptureFieldName]),
) as Record<string, CaptureFieldName>

const VENDOR_FIELD_TYPE: Record<CaptureFieldName, string> = {
  cardNumber: 'card-number',
  expiry: 'card-expiration-date',
  cvc: 'card-security-code',
  cardholderName: 'text',
}

/**
 * Tokenization defaults.
 *
 * These match what the outbound route expects, so they are not cosmetic.
 * The card number is stored persistently with a format-preserving alias; the
 * security code is volatile and short lived by design. Overriding either one
 * silently breaks the reveal, and the failure mode is the alias being
 * forwarded to the rail as if it were a card number.
 */
const TOKENIZATION: Partial<Record<CaptureFieldName, { format: string; storage: string }>> = {
  cardNumber: { format: 'FPE_SIX_T_FOUR', storage: 'PERSISTENT' },
  cvc: { format: 'NUM_LENGTH_PRESERVING', storage: 'VOLATILE' },
}

function normaliseBrand(raw: unknown): CardBrand | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  const key = raw.toLowerCase().replace(/[\s_]/g, '')
  const map: Record<string, CardBrand> = {
    visa: 'visa',
    mastercard: 'mastercard',
    amex: 'amex',
    americanexpress: 'amex',
    discover: 'discover',
    diners: 'diners',
    dinersclub: 'diners',
    jcb: 'jcb',
    unionpay: 'unionpay',
    maestro: 'maestro',
  }
  return map[key] ?? 'unknown'
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * Expiry years arrive as two or four digits depending on the input mask.
 * Normalising here keeps the ambiguity out of every downstream caller.
 */
function normaliseExpiryYear(raw: unknown): number | null {
  const year = asNumber(raw)
  if (year === null) return null
  if (year >= 1000) return year
  if (year >= 0 && year < 100) return 2000 + year
  return null
}

/** Folds one vendor state blob into our normalised shape. */
export function normaliseVendorState(
  previous: CaptureState,
  vendorState: Record<string, unknown>,
): CaptureState {
  const fields = { ...previous.fields }
  let brand = previous.brand
  let last4 = previous.last4

  for (const [vendorName, rawField] of Object.entries(vendorState)) {
    const name = OUR_FIELD_NAME[vendorName]
    if (!name || typeof rawField !== 'object' || rawField === null) continue
    const f = rawField as Record<string, unknown>

    const next: CaptureFieldState = {
      name,
      mounted: true,
      focused: Boolean(f.isFocused),
      touched: Boolean(f.isTouched ?? f.isDirty),
      dirty: Boolean(f.isDirty),
      valid: Boolean(f.isValid),
      message: asString(f.errorMessages instanceof Array ? f.errorMessages[0] : f.errorMessage),
    }
    fields[name] = next

    if (name === 'cardNumber') {
      brand = normaliseBrand(f.cardType ?? f.brand) ?? brand
      last4 = asString(f.last4) ?? last4
    }
  }

  return {
    fields,
    ready: isReady(fields),
    complete: isComplete(fields),
    brand,
    last4,
  }
}

export interface CaptureFormOptions {
  /**
   * Reads the CURRENT grant, every time, rather than closing over one.
   *
   * A grant is short lived and gets replaced — after a save, and shortly before
   * expiry. Holding the object meant a replacement had to rebuild the whole
   * form, which destroys the vault iframes and everything typed into them. The
   * tenant and environment are fixed for the life of the form; only the token
   * changes, and only `submit` needs it.
   */
  getSession: () => CaptureSession
  script: VaultScriptConfig
  /** Called on every state change with the full normalised state. */
  onStateChange: (state: CaptureState) => void
  /** Called when the cardholder presses Enter inside any field. */
  onEnter?: () => void
}

export interface MountFieldOptions extends CaptureFieldOptions {
  name: CaptureFieldName
  /** CSS selector for the container element the iframe is mounted into. */
  selector: string
}

/**
 * A mounted capture form.
 *
 * Create one per checkout. Mount each field as its container appears, submit
 * once, then destroy. Reusing a form across submissions is not supported by
 * the vault and is not worth emulating.
 */
export class CaptureForm {
  private readonly options: CaptureFormOptions
  private form: VaultFormHandle | null = null
  private readonly fields = new Map<CaptureFieldName, VaultFieldHandle>()
  private state: CaptureState = emptyCaptureState()
  private destroyed = false

  private constructor(options: CaptureFormOptions) {
    this.options = options
  }

  static async create(options: CaptureFormOptions): Promise<CaptureForm> {
    const instance = new CaptureForm(options)
    const global: VaultCollectGlobal = await loadVaultScript(options.script)
    if (instance.destroyed) return instance

    const session = options.getSession()

    instance.form = global.create(session.tenantId, session.environment, vendorState => {
      instance.state = normaliseVendorState(instance.state, vendorState)
      options.onStateChange(instance.state)
    })

    if (options.onEnter && typeof instance.form.on === 'function') {
      // Cross-frame Enter does not submit natively, so it has to be wired.
      instance.form.on('enterPress', () => options.onEnter?.())
    }

    return instance
  }

  get currentState(): CaptureState {
    return this.state
  }

  mountField(options: MountFieldOptions): void {
    if (!this.form || this.destroyed) return
    if (this.fields.has(options.name)) return

    const tokenization = TOKENIZATION[options.name]
    const handle = this.form.field(options.selector, {
      type: VENDOR_FIELD_TYPE[options.name],
      name: VENDOR_FIELD_NAME[options.name],
      validations: options.name === 'cardholderName' ? [] : ['required'],
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
      ...(options.ariaLabel ? { ariaLabel: options.ariaLabel } : {}),
      ...(options.autoComplete ? { autoComplete: options.autoComplete } : {}),
      ...(options.style ? { css: options.style } : {}),
      ...(tokenization ? { tokenization } : {}),
    })

    this.fields.set(options.name, handle)
  }

  unmountField(name: CaptureFieldName): void {
    const handle = this.fields.get(name)
    if (!handle) return
    try {
      handle.unmount()
    } catch {
      // The vault throws when the container has already gone. Nothing to do.
    }
    this.fields.delete(name)
    const fields = { ...this.state.fields }
    fields[name] = { ...fields[name], mounted: false, valid: false }
    this.state = {
      ...this.state,
      fields,
      ready: isReady(fields),
      complete: isComplete(fields),
    }
    this.options.onStateChange(this.state)
  }

  /**
   * Sends the captured card to the vault and returns a instrument handle.
   *
   * Nothing sensitive passes through this promise. The handle and descriptors
   * are safe to persist and to send to our own API.
   */
  async submit(cardholder?: { name?: string; email?: string }): Promise<CapturedInstrument> {
    if (!this.form || this.destroyed) {
      throw new CaptureError('vault_error', 'The capture form is not mounted.')
    }
    const session = this.options.getSession()
    if (!isSessionUsable(session)) {
      throw new CaptureError(
        'session_expired',
        'The capture session expired. Start the checkout again to mint a fresh one.',
      )
    }
    if (!this.state.complete) {
      throw new CaptureError('incomplete', 'Every card field must be filled in and valid.')
    }

    const data =
      cardholder?.name || cardholder?.email
        ? {
            cardholder: {
              ...(cardholder.name ? { name: cardholder.name } : {}),
              ...(cardholder.email ? { email: cardholder.email } : {}),
            },
          }
        : undefined

    const raw = await new Promise<unknown>((resolve, reject) => {
      this.form!.createCard({ auth: session.token, ...(data ? { data } : {}) }, resolve, reject)
    }).catch((error: unknown) => {
      throw toCaptureError(error)
    })

    return toInstrument(raw)
  }

  destroy(): void {
    this.destroyed = true
    for (const name of [...this.fields.keys()]) {
      const handle = this.fields.get(name)
      try {
        handle?.unmount()
      } catch {
        // Already gone.
      }
    }
    this.fields.clear()
    try {
      this.form?.unmount()
    } catch {
      // Already gone.
    }
    this.form = null
  }
}

/**
 * Maps a vault failure onto our error codes.
 *
 * A duplicate card is deliberately not an error. The vault returns the
 * existing card, which is exactly what a returning customer re-entering the
 * same card should produce.
 */
export function toCaptureError(error: unknown): CaptureError {
  if (error instanceof CaptureError) return error

  const e = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>
  const status = asNumber(e.status ?? e.statusCode)
  const requestId = asString(e.requestId ?? e['vgs-request-id'])
  const message = asString(e.message) ?? asString(e.error) ?? 'The vault rejected the card details.'

  if (status !== null && status >= 500) {
    return new CaptureError('vault_error', message, requestId)
  }
  // 401/403 is the grant, not the card. Reporting it as a decline sends the
  // cardholder away to find another card, which will be declined too.
  if (status === 401 || status === 403) {
    return new CaptureError(
      'session_expired',
      'The capture session is no longer valid. Refresh and try again.',
      requestId,
    )
  }
  if (status !== null && status >= 400) {
    return new CaptureError('rejected', message, requestId)
  }
  if (status === null && /network|fetch|timeout/i.test(message)) {
    return new CaptureError('network', message, requestId)
  }
  return new CaptureError('vault_error', message, requestId)
}

/** Pulls our instrument shape out of the vault's card object. */
// No BIN, and no leading digits of any length, anywhere in this file. The vault
// offers `bin` and `first8` and we read neither. Stripe's card object carries no
// such field either. The brand comes from the vault directly, and recognising a
// returning card is the vault card id's job, so leading digits would buy nothing
// and would put ten or twelve digits of a sixteen digit card in our database.

export function toInstrument(raw: unknown): CapturedInstrument {
  const root = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const data = (root.data ?? root) as Record<string, unknown>
  const attributes = (data.attributes ?? data) as Record<string, unknown>

  const handle = asString(data.id ?? root.id)
  if (!handle) {
    throw new CaptureError('vault_error', 'The vault did not return a instrument identifier.')
  }

  // Required, and thrown on rather than defaulted. An empty string here files
  // a card nobody can identify in a list of saved cards, and nothing flags it.
  const last4 = asString(attributes.last4)
  if (!last4) {
    throw new CaptureError('vault_error', 'The vault did not return the last four digits.')
  }

  const expMonth = asNumber(attributes.exp_month)
  const expYear = normaliseExpiryYear(attributes.exp_year)
  if (expMonth === null || expYear === null) {
    throw new CaptureError('vault_error', 'The vault did not return a usable card expiry.')
  }

  const enriched = (attributes.enriched_attributes ?? {}) as Record<string, unknown>
  const properties = (enriched.card_properties ?? {}) as Record<string, unknown>

  const descriptors: InstrumentDescriptors = {
    brand: normaliseBrand(attributes.card_brand ?? properties.brand) ?? 'unknown',
    last4,
    expMonth,
    expYear,
    funding: asString(attributes.card_type ?? properties.funding),
    issuerCountry: asString(properties.issuer_country ?? properties.country),
    // No fingerprint. The vault derives it from the PAN, and we keep nothing
    // PAN-derived. A returning card is recognised by the vault card id, which
    // the vault repeats because it deduplicates on its own side.
  }

  return { handle, descriptors }
}
