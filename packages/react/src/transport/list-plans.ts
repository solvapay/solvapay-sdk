/**
 * Shared `defaultListPlans` fetcher used by `<PlanSelector>` and
 * `<CheckoutLayout>` when no custom `fetcher` prop is provided.
 *
 * Route order:
 *  1. Prefer a configured transport's `listPlans` (HTTP transport
 *     implements it; the MCP adapter omits it after Phase 2c).
 *  2. When the transport omits the method, echo the already-seeded
 *     `plansCache` entry — the plans arrived on the bootstrap snapshot
 *     and `seedMcpCaches` populated the cache. Matches the
 *     "accept in-session staleness, fetcher is a no-op" policy and
 *     avoids a broken `/api/list-plans` request from inside the MCP
 *     iframe.
 *  3. Fall back to `GET config.api.listPlans` (default `/api/list-plans`)
 *     for non-transport HTTP integrators.
 */

import type { Plan, SolvaPayConfig } from '../types'
import { buildRequestHeaders } from '../utils/headers'
import { plansCache } from '../hooks/usePlans'

export async function defaultListPlans(
  productRef: string,
  config: SolvaPayConfig | undefined,
): Promise<Plan[]> {
  const transport = config?.transport
  if (transport) {
    return transport.listPlans
      ? transport.listPlans(productRef)
      : (plansCache.get(productRef)?.plans ?? [])
  }

  const base = config?.api?.listPlans || '/api/list-plans'
  const url = `${base}?productRef=${encodeURIComponent(productRef)}`
  const fetchFn = config?.fetch || fetch
  const { headers } = await buildRequestHeaders(config)
  const res = await fetchFn(url, { method: 'GET', headers })
  if (!res.ok) {
    const error = new Error(`Failed to fetch plans: ${res.statusText || res.status}`)
    config?.onError?.(error, 'listPlans')
    throw error
  }
  const data = (await res.json()) as { plans?: Plan[] }
  return data.plans ?? []
}
