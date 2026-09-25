/**
 * A fake vault capture script, for jsdom.
 *
 * The real capture surface is cross-origin iframes served by the vault. jsdom
 * has no iframes worth the name, and Playwright cannot reliably type into a
 * third party's, so without this every test that renders card fields either
 * cannot run or quietly depends on the vault's sandbox being up. Neither is
 * acceptable for a payment path.
 *
 * What this provides is a stand-in that is honest about the seam: it installs
 * the same `window.VGSCollect` global the real script installs, renders real
 * `<input>` elements into the same containers, and reports state in the
 * vendor's own shape so the production normaliser is the thing under test
 * rather than a test-only copy of it.
 *
 * What it deliberately does NOT do is model the vault's security. A test that
 * passes here proves the wiring, not that a card never reached our server.
 * That property comes from the architecture and from the guardrails in the
 * platform, and it cannot be tested by a mock that has no iframe boundary.
 */

export interface MockVaultCard {
  /** Vault card id, the value that becomes the instrument handle. */
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  funding?: string
  issuerCountry?: string
}

export interface MockVaultFailure {
  /** Drives the error code the capture surface maps to. 4xx rejects, 5xx is a vault error. */
  status?: number
  message?: string
  requestId?: string
}

export interface MockVaultOptions {
  /** The card the vault "stores". Defaults to a Visa test card. */
  card?: Partial<MockVaultCard>
  /** When set, `createCard` fails instead of succeeding. */
  failCreateCard?: MockVaultFailure
  /**
   * Fields start valid, so a test that only cares about submission does not
   * have to type into four inputs. Set false to drive validity by typing.
   */
  startValid?: boolean
}

export interface MockVaultFieldCall {
  selector: string
  options: Record<string, unknown>
}

export interface MockVaultCreateCardCall {
  auth: string
  data?: Record<string, unknown>
}

/** What the mock recorded. Assert against this rather than on internals. */
export interface MockVault {
  /** `create()` calls, so a test can assert the tenant and environment used. */
  created: { tenantId: string; environment: string }[]
  /** Every `field()` call, in order, with the options the surface passed. */
  fields: MockVaultFieldCall[]
  /** Every `createCard()` call. The auth value is the capture grant's token. */
  createCardCalls: MockVaultCreateCardCall[]
  /** Types into a mounted field and pushes new state, as the real one would. */
  type(vendorFieldName: string, value: string): void
  /** Marks a field invalid, for testing the error surface. */
  invalidate(vendorFieldName: string, message?: string): void
  /** Fires the vendor's Enter event. */
  pressEnter(): void
  /** Removes the global and the rendered inputs. */
  uninstall(): void
}

const DEFAULT_CARD: MockVaultCard = {
  id: 'card_mock000000000001',
  brand: 'VISA',
  last4: '4242',
  expMonth: 12,
  expYear: 2030,
  funding: 'credit',
  issuerCountry: 'US',
}

/** The vendor's own field names. Kept here so the mock speaks their language. */
export const MOCK_VAULT_FIELD_NAMES = {
  cardNumber: 'card_number',
  expiry: 'card_expirationDate',
  cvc: 'card_cvc',
  cardholderName: 'card_holderName',
} as const

interface FieldRecord {
  vendorName: string
  selector: string
  input: HTMLInputElement
  isValid: boolean
  isDirty: boolean
  isTouched: boolean
  isFocused: boolean
  errorMessages: string[]
}

/**
 * Installs the fake global. Call in `beforeEach`, and `uninstall()` after.
 *
 * Remember to reset the production loader's module cache too
 * (`resetVaultScriptLoaderForTests`), or a later test inherits this global.
 */
export function installMockVault(options: MockVaultOptions = {}): MockVault {
  const card: MockVaultCard = { ...DEFAULT_CARD, ...options.card }
  const startValid = options.startValid ?? true

  const fieldRecords = new Map<string, FieldRecord>()
  const created: { tenantId: string; environment: string }[] = []
  const fieldCalls: MockVaultFieldCall[] = []
  const createCardCalls: MockVaultCreateCardCall[] = []

  let onStateChange: ((state: Record<string, unknown>) => void) | null = null
  let onEnter: (() => void) | null = null

  const vendorState = (): Record<string, unknown> => {
    const state: Record<string, unknown> = {}
    for (const record of fieldRecords.values()) {
      state[record.vendorName] = {
        isValid: record.isValid,
        isDirty: record.isDirty,
        isTouched: record.isTouched,
        isFocused: record.isFocused,
        errorMessages: record.errorMessages,
        ...(record.vendorName === MOCK_VAULT_FIELD_NAMES.cardNumber
          ? { cardType: card.brand, last4: card.last4 }
          : {}),
      }
    }
    return state
  }

  const publish = () => onStateChange?.(vendorState())

  const global = {
    create(
      tenantId: string,
      environment: string,
      stateCallback: (state: Record<string, unknown>) => void,
    ) {
      created.push({ tenantId, environment })
      onStateChange = stateCallback

      return {
        field(selector: string, fieldOptions: Record<string, unknown>) {
          fieldCalls.push({ selector, options: { ...fieldOptions } })

          const vendorName = String(fieldOptions.name ?? selector)
          const container = document.querySelector(selector)

          // A real input in the container the surface owns. This is the part
          // jsdom cannot do for itself, and the reason this file exists.
          const input = document.createElement('input')
          input.setAttribute('data-mock-vault-field', vendorName)
          if (typeof fieldOptions.placeholder === 'string') {
            input.placeholder = fieldOptions.placeholder
          }
          if (typeof fieldOptions.ariaLabel === 'string') {
            input.setAttribute('aria-label', fieldOptions.ariaLabel)
          }
          container?.appendChild(input)

          const record: FieldRecord = {
            vendorName,
            selector,
            input,
            isValid: startValid,
            isDirty: startValid,
            isTouched: startValid,
            isFocused: false,
            errorMessages: [],
          }
          fieldRecords.set(vendorName, record)

          input.addEventListener('input', () => {
            record.isDirty = true
            record.isTouched = true
            record.isValid = input.value.length > 0
            record.errorMessages = record.isValid ? [] : ['This field is required']
            publish()
          })

          // The real script publishes as soon as a field mounts, which is how
          // the surface learns a field exists at all.
          publish()

          return {
            on(_event: string, _handler: (payload: unknown) => void) {
              // The surface subscribes per field but drives state from the
              // form-level callback, so there is nothing to emit here.
            },
            unmount() {
              input.remove()
              fieldRecords.delete(vendorName)
              publish()
            },
          }
        },

        createCard(
          payload: { auth: string; data?: Record<string, unknown> },
          onSuccess: (raw: unknown) => void,
          onError: (error: unknown) => void,
        ) {
          createCardCalls.push({
            auth: payload.auth,
            ...(payload.data ? { data: payload.data } : {}),
          })

          if (options.failCreateCard) {
            const failure = options.failCreateCard
            // Async, like the real one, so a test cannot pass by accident on
            // synchronous ordering the vault would never give it.
            setTimeout(
              () =>
                onError({
                  status: failure.status ?? 400,
                  message: failure.message ?? 'The vault rejected the card details.',
                  requestId: failure.requestId ?? 'req_mock_0001',
                }),
              0,
            )
            return
          }

          // The vault's own response envelope, so `toInstrument` is exercised
          // rather than bypassed. Note there is no PAN and no alias here: the
          // real response does not hand those back either.
          setTimeout(
            () =>
              onSuccess({
                data: {
                  id: card.id,
                  attributes: {
                    last4: card.last4,
                    card_brand: card.brand,
                    exp_month: card.expMonth,
                    exp_year: card.expYear,
                    card_type: card.funding,
                    enriched_attributes: {
                      card_properties: {
                        issuer_country: card.issuerCountry,
                      },
                    },
                  },
                },
              }),
            0,
          )
        },

        on(event: string, handler: () => void) {
          if (event === 'enterPress') onEnter = handler
        },

        unmount() {
          for (const record of fieldRecords.values()) record.input.remove()
          fieldRecords.clear()
        },
      }
    },
  }

  ;(window as unknown as Record<string, unknown>).VGSCollect = global

  return {
    created,
    fields: fieldCalls,
    createCardCalls,

    type(vendorFieldName: string, value: string) {
      const record = fieldRecords.get(vendorFieldName)
      if (!record) {
        throw new Error(
          `Mock vault has no mounted field "${vendorFieldName}". Mounted: ${
            [...fieldRecords.keys()].join(', ') || 'none'
          }`,
        )
      }
      record.input.value = value
      record.input.dispatchEvent(new Event('input', { bubbles: true }))
    },

    invalidate(vendorFieldName: string, message = 'Invalid') {
      const record = fieldRecords.get(vendorFieldName)
      if (!record) throw new Error(`Mock vault has no mounted field "${vendorFieldName}".`)
      record.isValid = false
      record.isTouched = true
      record.errorMessages = [message]
      publish()
    },

    pressEnter() {
      onEnter?.()
    },

    uninstall() {
      for (const record of fieldRecords.values()) record.input.remove()
      fieldRecords.clear()
      onStateChange = null
      onEnter = null
      delete (window as unknown as Record<string, unknown>).VGSCollect
    },
  }
}

/**
 * A capture session shaped like the one the platform mints.
 *
 * The token is obvious nonsense on purpose: if it ever shows up in a snapshot
 * or a log, it should be recognisable as a test value at a glance.
 */
export function mockCaptureSession(
  over: Partial<{
    token: string
    tenantId: string
    environment: 'sandbox' | 'live'
    expiresAt: number
    captureSessionId: string
  }> = {},
) {
  return {
    token: 'mock-vault-write-token',
    tenantId: 'tnt_mock',
    environment: 'sandbox' as const,
    expiresAt: Date.now() + 10 * 60 * 1000,
    captureSessionId: 'cap_mock00000000000000000000000000',
    ...over,
  }
}
