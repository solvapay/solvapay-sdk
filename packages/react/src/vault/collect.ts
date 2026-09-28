/**
 * VGS Collect bridge for vault checkout (`captureMode: 'vault'`).
 *
 * VGS Collect renders the card number, expiry and CVC as hosted iframes, so
 * the card never enters the integrator's DOM. `PaymentForm.CardFields`
 * mounts the fields; on submit the SDK asks the backend for a capture grant
 * (a short-lived vault token bound to the payment) and calls
 * `form.createCard` with it. Only the resulting card id travels back to
 * SolvaPay — see the `create-a-card-using-vgs-collect` guide in VGS docs.
 *
 * The Collect script is loaded from the VGS CDN on first use; it is not an
 * npm dependency. Tests and non-browser hosts swap the loader with
 * `configureCollect` (`@solvapay/test-utils` ships a fake).
 */

export const VGS_COLLECT_VERSION = '4.0.1'
export const VGS_COLLECT_SCRIPT_URL = `https://js.verygoodvault.com/vgs-collect/${VGS_COLLECT_VERSION}/vgs-collect.js`
/** Subresource Integrity of that exact file, as published on the VGS dashboard for 4.0.1. */
export const VGS_COLLECT_SCRIPT_INTEGRITY =
  'sha384-Sr5xwyR0H5rcDXa7/iDJDM3qBBvtHuR97A8ELbd+DFBDi32Caf72to9UVqvI8R95'

export type CollectEnvironment = 'sandbox' | 'live'

export interface CollectFieldState {
  isValid?: boolean
  isEmpty?: boolean
  isDirty?: boolean
  isTouched?: boolean
  isFocused?: boolean
  errorMessages?: string[]
  /** VGS error objects: 1001 required, 1011 card number, 1015 expiry, 1017 CVC. */
  errors?: Array<{ code?: number; message?: string; description?: string }>
  last4?: string
  bin?: string
  cardType?: string
}

export type CollectFormState = Record<string, CollectFieldState>

export interface CollectFieldOptions {
  name?: string
  placeholder?: string
  css?: Record<string, unknown>
  validations?: string[]
  /** Expiry only: 2 or 4. */
  yearLength?: 2 | 4
  autoComplete?: string
  ariaLabel?: string
  inputMode?: string
  /** Card number only: brand icon inside the field. */
  showCardIcon?: boolean | { left?: string; right?: string; width?: string; height?: string }
  /** Class names Collect toggles on the input for each state (used by `&.invalid` selectors). */
  classes?: Partial<Record<'invalid' | 'valid' | 'empty' | 'focused' | 'dirty' | 'touched', string>>
  [key: string]: unknown
}

/** The parts of a VGS Collect form the SDK uses. */
export interface CollectForm {
  cardNumberField(selector: string | HTMLElement, options?: CollectFieldOptions): unknown
  cardExpirationDateField(selector: string | HTMLElement, options?: CollectFieldOptions): unknown
  cardCVCField(selector: string | HTMLElement, options?: CollectFieldOptions): unknown
  cardholderNameField(selector: string | HTMLElement, options?: CollectFieldOptions): unknown
  createCard(
    options: { auth: string; data?: Record<string, unknown> },
    onResponse: (status: number, body: unknown) => void,
    onError: (error: unknown) => void,
  ): void
  unmount?(): void
  reset?(): void
}

export interface CollectSessionOptions {
  vaultId: string
  env: CollectEnvironment
  stateCallback?: (state: CollectFormState) => void
  onErrorCallback?: (error: unknown) => void
}

/** How the SDK obtains a Collect form. Replaceable for tests and hosts without the CDN. */
export type CollectLoader = (options: CollectSessionOptions) => Promise<CollectForm>

interface VgsCollectGlobal {
  create?: (
    vaultId: string,
    env: CollectEnvironment,
    stateCallback?: (state: CollectFormState) => void,
  ) => CollectForm
}

declare global {
  interface Window {
    VGSCollect?: VgsCollectGlobal
  }
}

let scriptPromise: Promise<VgsCollectGlobal> | null = null

function loadCollectScript(): Promise<VgsCollectGlobal> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('VGS Collect is only available in the browser'))
  }
  if (window.VGSCollect) return Promise.resolve(window.VGSCollect)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<VgsCollectGlobal>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${VGS_COLLECT_SCRIPT_URL}"]`,
    )
    const script = existing ?? document.createElement('script')
    const done = () => {
      if (window.VGSCollect) {
        resolve(window.VGSCollect)
        return
      }
      scriptPromise = null
      reject(new Error('VGS Collect script loaded but window.VGSCollect is missing'))
    }
    script.addEventListener('load', done)
    script.addEventListener('error', () => {
      scriptPromise = null
      reject(new Error('Failed to load VGS Collect'))
    })
    if (!existing) {
      script.src = VGS_COLLECT_SCRIPT_URL
      script.setAttribute('integrity', VGS_COLLECT_SCRIPT_INTEGRITY)
      script.setAttribute('crossorigin', 'anonymous')
      script.async = true
      document.head.appendChild(script)
    }
  })
  return scriptPromise
}

/**
 * `create(vaultId, env, stateCallback)` is the initialisation VGS's dashboard
 * gives for Collect 4.0.1. `session()` is not used: it loads a named form
 * configuration that must exist in the VGS dashboard, and without one the
 * form never mounts (403 on `session-configuration/<tenant>/<formId>.json`).
 */
const cdnLoader: CollectLoader = async options => {
  const vgs = await loadCollectScript()
  if (!vgs.create) {
    throw new Error('Unsupported VGS Collect build: create() is not available')
  }
  return vgs.create(options.vaultId, options.env, options.stateCallback)
}

let activeLoader: CollectLoader = cdnLoader

/** Replace how Collect forms are created (tests, non-CDN hosts). Returns a restore function. */
export function configureCollect(loader: CollectLoader | null): () => void {
  const previous = activeLoader
  activeLoader = loader ?? cdnLoader
  return () => {
    activeLoader = previous
  }
}

export function createCollectForm(options: CollectSessionOptions): Promise<CollectForm> {
  return activeLoader(options)
}

/** The card the vault just wrote. Aliases stay in the vault; only the id leaves the browser. */
export interface CapturedCard {
  cardId: string
  last4?: string
  brand?: string
  expMonth?: number
  expYear?: number
}

export class CardCaptureError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'CardCaptureError'
    this.status = status
  }
}

/**
 * Write the card in `form` into the vault under `grant`. No `meta` is sent:
 * Collect writes its own card meta, so the browser cannot stamp the payment on
 * the card. The backend binds the card to the payment at confirm instead: it
 * must have been captured inside the payment's grant window and not used for
 * another payment.
 */
export function captureCard(form: CollectForm, grant: { token: string }): Promise<CapturedCard> {
  return new Promise<CapturedCard>((resolve, reject) => {
    form.createCard(
      { auth: grant.token, data: {} },
      (status, body) => {
        const card = parseCardResponse(body)
        if (status >= 200 && status < 300 && card) {
          resolve(card)
          return
        }
        reject(new CardCaptureError(`Card capture failed with status ${status}`, status))
      },
      error => {
        reject(
          error instanceof Error
            ? new CardCaptureError(error.message)
            : new CardCaptureError('Card capture failed'),
        )
      },
    )
  })
}

function parseCardResponse(body: unknown): CapturedCard | null {
  const data = (body as { data?: Record<string, unknown> } | undefined)?.data
  if (!data || typeof data.id !== 'string' || !data.id) return null
  const attributes = (data.attributes ?? {}) as Record<string, unknown>
  const year = Number(attributes.exp_year)
  return {
    cardId: data.id,
    last4: typeof attributes.last4 === 'string' ? attributes.last4 : undefined,
    brand: typeof attributes.card_brand === 'string' ? attributes.card_brand : undefined,
    expMonth: Number.isFinite(Number(attributes.exp_month))
      ? Number(attributes.exp_month)
      : undefined,
    expYear: Number.isFinite(year) ? (year < 100 ? 2000 + year : year) : undefined,
  }
}

/** True when every mounted field reports valid. */
export function isCollectFormComplete(state: CollectFormState | null | undefined): boolean {
  if (!state) return false
  const fields = Object.values(state)
  return fields.length > 0 && fields.every(f => f.isValid === true)
}
