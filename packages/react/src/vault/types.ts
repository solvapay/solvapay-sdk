/**
 * Contracts for the vault capture surface.
 *
 * This is the second capture surface alongside the PSP element. It renders
 * sensitive inputs as cross-origin iframes served by the vault, so card data
 * travels from the browser to the vault and never reaches our servers or the
 * host page.
 *
 * Nothing here names a rail. A credential captured through this surface is
 * connector-neutral: the bridge decides later how to present it. Nothing here
 * names the vault vendor either, so the React layer stays free of it.
 */

/** The sensitive inputs the surface can render. */
export type CaptureFieldName = 'cardNumber' | 'expiry' | 'cvc' | 'cardholderName'

/** Fields that must be present and valid before a capture can be submitted. */
export const REQUIRED_CAPTURE_FIELDS: readonly CaptureFieldName[] = [
  'cardNumber',
  'expiry',
  'cvc',
] as const

export type CaptureEnvironment = 'sandbox' | 'live'

export type CardBrand =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'discover'
  | 'diners'
  | 'jcb'
  | 'unionpay'
  | 'maestro'
  | 'unknown'

/**
 * A short-lived grant to write one credential into the vault.
 *
 * Minted server side and scoped to credential creation only. It is not a
 * secret in the sense of an API key: it is write-only, expires quickly, and is
 * bound to a checkout session. It still must not be minted by an
 * unauthenticated endpoint, or it becomes a free card-vaulting service for
 * whoever finds it.
 */
export interface CaptureSession {
  token: string
  tenantId: string
  environment: CaptureEnvironment
  /** Epoch milliseconds. The surface refuses to submit after this. */
  expiresAt: number
}

export interface CaptureFieldState {
  name: CaptureFieldName
  /** The iframe has loaded and is accepting input. */
  mounted: boolean
  focused: boolean
  /** Has been focused and blurred at least once. */
  touched: boolean
  /** The value has changed since mount. */
  dirty: boolean
  valid: boolean
  /** Validation message, already localised by the vault where it supplies one. */
  message: string | null
}

/**
 * Normalised state for the whole surface.
 *
 * Deliberately shaped so a consumer never branches on which capture surface is
 * mounted. The PSP element path reports the same three booleans.
 */
export interface CaptureState {
  fields: Record<CaptureFieldName, CaptureFieldState>
  /** Every required field has mounted. Gates rendering, not submission. */
  ready: boolean
  /** Every required field is valid. Gates submission. */
  complete: boolean
  brand: CardBrand | null
  /** Leading digits, when the vault reports them. Never the full number. */
  bin: string | null
  last4: string | null
}

/**
 * What comes back from a successful capture.
 *
 * `handle` is the vault's identifier for the stored card. It is not card data,
 * so it is safe to persist, log and send to our own API. The descriptors are
 * the non-sensitive facts the vault returns alongside it, and they are worth
 * persisting because they drive routing, fee and fraud decisions we would
 * otherwise learn late or not at all.
 */
export interface CapturedCredential {
  handle: string
  descriptors: CredentialDescriptors
}

export interface CredentialDescriptors {
  brand: CardBrand
  last4: string
  bin: string | null
  expMonth: number
  expYear: number
  /** debit, credit, prepaid, where the vault reports it. */
  funding: string | null
  issuerCountry: string | null
  /**
   * Stable per-card identifier from the vault. Two captures of the same card
   * share it, which is how a returning customer is recognised.
   */
  fingerprint: string | null
}

export type CaptureErrorCode =
  /** The script could not be loaded, most often a CSP or network problem. */
  | 'script_load_failed'
  /** The capture session expired before submit. */
  | 'session_expired'
  /** One or more required fields are missing or invalid. */
  | 'incomplete'
  /** The vault rejected the card. */
  | 'rejected'
  /** The vault was reachable but something else went wrong. */
  | 'vault_error'
  /** Network failure talking to the vault. */
  | 'network'

export class CaptureError extends Error {
  readonly code: CaptureErrorCode
  /** Vendor request identifier, when present. Not sensitive, worth logging. */
  readonly requestId: string | null

  constructor(code: CaptureErrorCode, message: string, requestId: string | null = null) {
    super(message)
    this.name = 'CaptureError'
    this.code = code
    this.requestId = requestId
  }
}

/** Styling crosses into the iframe as values, not as a stylesheet. */
export interface CaptureFieldStyle {
  color?: string
  fontFamily?: string
  fontSize?: string
  fontWeight?: string | number
  letterSpacing?: string
  lineHeight?: string
  padding?: string
  '&::placeholder'?: { color?: string }
  '&:focus'?: { color?: string }
  '&.invalid'?: { color?: string }
}

export interface CaptureFieldOptions {
  /** Placeholder text. Supply a localised string; the surface does not translate. */
  placeholder?: string
  /** Resolved literal values. CSS custom properties do not cross the frame. */
  style?: CaptureFieldStyle
  /** Passed to the underlying input for assistive technology. */
  ariaLabel?: string
  autoComplete?: string
}

export function emptyFieldState(name: CaptureFieldName): CaptureFieldState {
  return {
    name,
    mounted: false,
    focused: false,
    touched: false,
    dirty: false,
    valid: false,
    message: null,
  }
}

export function emptyCaptureState(): CaptureState {
  return {
    fields: {
      cardNumber: emptyFieldState('cardNumber'),
      expiry: emptyFieldState('expiry'),
      cvc: emptyFieldState('cvc'),
      cardholderName: emptyFieldState('cardholderName'),
    },
    ready: false,
    complete: false,
    brand: null,
    bin: null,
    last4: null,
  }
}

/** True when every required field has mounted. */
export function isReady(fields: Record<CaptureFieldName, CaptureFieldState>): boolean {
  return REQUIRED_CAPTURE_FIELDS.every(name => fields[name].mounted)
}

/** True when every required field has mounted and is valid. */
export function isComplete(fields: Record<CaptureFieldName, CaptureFieldState>): boolean {
  return REQUIRED_CAPTURE_FIELDS.every(name => fields[name].mounted && fields[name].valid)
}

/** A capture session is usable until it expires. Leaves a second of slack. */
export function isSessionUsable(session: CaptureSession, now: number = Date.now()): boolean {
  return session.expiresAt - 1000 > now
}
