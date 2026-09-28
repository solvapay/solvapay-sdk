/**
 * In-memory stand-in for VGS Collect, for `@solvapay/react` tests.
 *
 * `createFakeCollect()` returns a loader for `configureCollect` plus handles
 * to drive it: the fields "mount" into the given elements, `enter()` flips
 * the form to valid, and `createCard` resolves with a CMP-shaped card
 * object whose `meta` is what the SDK sent (so tests can assert the
 * payment binding). No network, no iframes.
 */

export interface FakeCollectCard {
  id: string
  meta: Record<string, string>
  auth: string
  attributes: { last4: string; card_brand: string; exp_month: number; exp_year: number }
}

export interface FakeCollectOptions {
  /** Card id the next `createCard` returns. Default `CRD_fake_1`, `CRD_fake_2`, ... */
  nextCardId?: () => string
  /** Fail `createCard` with this HTTP status instead of creating a card. */
  failWithStatus?: number
  last4?: string
  brand?: string
}

export interface FakeCollectHandle {
  /** Pass to `configureCollect` from `@solvapay/react`. */
  loader: (options: {
    vaultId: string
    env: 'sandbox' | 'live'
    stateCallback?: (state: Record<string, { isValid?: boolean }>) => void
  }) => Promise<FakeCollectForm>
  /** Every form created so far. */
  forms: FakeCollectForm[]
  /** Every card created so far, across forms. */
  cards: FakeCollectCard[]
  /** Simulate the payer completing all fields on the latest form. */
  enter(): void
  /** Simulate the payer clearing a field on the latest form. */
  clear(): void
  options: FakeCollectOptions
}

export interface FakeCollectForm {
  vaultId: string
  env: 'sandbox' | 'live'
  mounted: string[]
  unmounted: boolean
  cardNumberField(el: string | HTMLElement, options?: Record<string, unknown>): void
  cardExpirationDateField(el: string | HTMLElement, options?: Record<string, unknown>): void
  cardCVCField(el: string | HTMLElement, options?: Record<string, unknown>): void
  cardholderNameField(el: string | HTMLElement, options?: Record<string, unknown>): void
  createCard(
    options: { auth: string; data?: Record<string, unknown> },
    onResponse: (status: number, body: unknown) => void,
    onError: (error: unknown) => void,
  ): void
  unmount(): void
}

export function createFakeCollect(options: FakeCollectOptions = {}): FakeCollectHandle {
  let counter = 0
  const handle: FakeCollectHandle = {
    forms: [],
    cards: [],
    options,
    loader: async ({ vaultId, env, stateCallback }) => {
      const state: Record<string, { isValid?: boolean }> = {}
      const emit = () => stateCallback?.({ ...state })
      const mount = (name: string) => {
        form.mounted.push(name)
        state[name] = { isValid: false }
        emit()
      }
      const form: FakeCollectForm = {
        vaultId,
        env,
        mounted: [],
        unmounted: false,
        cardNumberField: () => mount('card_number'),
        cardExpirationDateField: () => mount('card_exp'),
        cardCVCField: () => mount('card_cvc'),
        cardholderNameField: () => mount('cardholder_name'),
        createCard: ({ auth, data }, onResponse, onError) => {
          const fail = handle.options.failWithStatus
          if (fail) {
            onResponse(fail, { errors: [{ detail: 'fake failure' }] })
            return
          }
          if (!auth) {
            onError(new Error('missing auth'))
            return
          }
          const meta = ((data?.meta as Record<string, string> | undefined) ?? {})
          const id = handle.options.nextCardId?.() ?? `CRD_fake_${++counter}`
          const card: FakeCollectCard = {
            id,
            meta,
            auth,
            attributes: {
              last4: handle.options.last4 ?? '4242',
              card_brand: handle.options.brand ?? 'VISA',
              exp_month: 12,
              exp_year: 30,
            },
          }
          handle.cards.push(card)
          onResponse(201, { data: { id, attributes: card.attributes }, meta })
        },
        unmount: () => {
          form.unmounted = true
        },
      }
      ;(form as FakeCollectForm & { _state: typeof state; _emit: () => void })._state = state
      ;(form as FakeCollectForm & { _state: typeof state; _emit: () => void })._emit = emit
      handle.forms.push(form)
      return form
    },
    enter() {
      const form = handle.forms[handle.forms.length - 1] as
        | (FakeCollectForm & { _state: Record<string, { isValid?: boolean }>; _emit: () => void })
        | undefined
      if (!form) throw new Error('createFakeCollect: no form mounted yet')
      for (const key of Object.keys(form._state)) form._state[key] = { isValid: true }
      form._emit()
    },
    clear() {
      const form = handle.forms[handle.forms.length - 1] as
        | (FakeCollectForm & { _state: Record<string, { isValid?: boolean }>; _emit: () => void })
        | undefined
      if (!form) throw new Error('createFakeCollect: no form mounted yet')
      const first = Object.keys(form._state)[0]
      if (first) form._state[first] = { isValid: false }
      form._emit()
    },
  }
  return handle
}

/**
 * Canonical vault test cards (design doc, section 8). Numbers are the
 * SolvaPay `BIN6 + 000...` scheme; the backend's simulator maps each to one
 * scenario. Use with a real sandbox tenant only through the SDK — never
 * send a number to SolvaPay directly.
 */
export const VAULT_TEST_CARDS = {
  visaSuccess: { number: '4242424242424242', expMonth: 12, expYear: 2030, cvc: '123' },
  visaDeclined: { number: '4000000000000002', expMonth: 12, expYear: 2030, cvc: '123' },
  visaRequires3ds: { number: '4000000000003220', expMonth: 12, expYear: 2030, cvc: '123' },
} as const
