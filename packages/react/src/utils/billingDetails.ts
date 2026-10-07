/**
 * The confirm route's `billingDetails`, built from what the checkout already
 * collects: the customer name field, the customer's email and the buyer
 * country with its state and postal code (the fields `isCustomerAddressComplete`
 * requires before paying). Nothing is sent without a country; empty values
 * are left out. The backend puts them on the card it creates on the rail.
 */

import type { BusinessDetailsInput } from '@solvapay/core'
import type { CardBillingDetails } from '@solvapay/server'

export type { CardBillingDetails }

export function buildBillingDetails(params: {
  name?: string | null
  email?: string | null
  businessDetails: Pick<
    BusinessDetailsInput,
    'customerName' | 'customerCountry' | 'customerState' | 'customerPostalCode'
  >
}): CardBillingDetails | undefined {
  const country = params.businessDetails.customerCountry?.trim()
  if (!country) return undefined
  const name = (params.name?.trim() || params.businessDetails.customerName)?.trim()
  const email = params.email?.trim()
  const state = params.businessDetails.customerState?.trim()
  const postalCode = params.businessDetails.customerPostalCode?.trim()
  return {
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    address: {
      ...(state ? { state } : {}),
      ...(postalCode ? { postalCode } : {}),
      country,
    },
  }
}
