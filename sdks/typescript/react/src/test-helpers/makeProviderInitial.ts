import type { Plan, Product, SolvaPayProviderInitial } from '../types'

/** Minimal MCP hydration seed for provider tests. */
export function makeProviderInitial(
  overrides: Partial<SolvaPayProviderInitial> = {},
): SolvaPayProviderInitial {
  const merchant = overrides.merchant ?? { displayName: 'Acme', legalName: 'Acme Inc' }
  const product: Product = overrides.product ?? { reference: 'prd_test', name: 'Test' }
  const plans: Plan[] = overrides.plans ?? [{ reference: 'pln_basic' }]

  return {
    customerRef: 'cus_test',
    purchase: null,
    paymentMethod: null,
    balance: null,
    usage: null,
    merchant,
    product,
    plans,
    ...overrides,
  }
}
