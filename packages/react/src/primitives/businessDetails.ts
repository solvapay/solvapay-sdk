import type {
  StripeAddressElementChangeEvent,
  StripeTaxIdElementChangeEvent,
} from '@stripe/stripe-js'

export interface BusinessDetailsPayload {
  address: {
    country: string
    postalCode?: string
    state?: string
    line1?: string
    city?: string
  }
  taxId?: {
    type: string
    value: string
  }
}

export function addressFromStripeElement(
  event: StripeAddressElementChangeEvent,
): BusinessDetailsPayload['address'] | undefined {
  const address = event.value.address
  if (!address.country) {
    return undefined
  }
  return {
    country: address.country,
    ...(address.postal_code ? { postalCode: address.postal_code } : {}),
    ...(address.state ? { state: address.state } : {}),
    ...(address.line1 ? { line1: address.line1 } : {}),
    ...(address.city ? { city: address.city } : {}),
  }
}

export function taxIdFromStripeElement(
  event: StripeTaxIdElementChangeEvent,
): BusinessDetailsPayload['taxId'] | undefined {
  const taxId = event.value
  const type = taxId.taxIdType ?? taxId.externalTaxIdType
  const value = taxId.taxId
  if (!type || !value) {
    return undefined
  }
  return { type, value }
}
