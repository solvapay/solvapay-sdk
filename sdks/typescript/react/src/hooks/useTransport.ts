import { useMemo } from 'react'
import { useSolvaPay } from './useSolvaPay'
import { createHttpTransport } from '../transport/http'
import type { SolvaPayTransport } from '../transport/types'

/**
 * Returns the effective data-access transport for the current provider.
 *
 * If the consumer passed a custom `transport` on `SolvaPayConfig`, that
 * instance is returned. Otherwise a fresh HTTP transport is built from
 * `config.api` + `config.fetch`. Memoised on the config identity so
 * HTTP-default consumers don't re-create a transport on every render.
 *
 * Use this from components that need a transport method the provider
 * doesn't already expose on its context (e.g. `createCustomerSession`,
 * `getPaymentMethod`, `listPlans`).
 */
export function useTransport(): SolvaPayTransport {
  const { _config } = useSolvaPay()
  return useMemo(() => _config?.transport ?? createHttpTransport(_config), [_config])
}
