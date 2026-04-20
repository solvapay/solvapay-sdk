import type { SolvaPayConfig } from '../types'

/**
 * Shared module-level WeakMap assigning a stable numeric id to every custom
 * `SolvaPayTransport` instance. The id is used to build cache keys for
 * transport-keyed single-flight caches (see `useMerchant`, `useProduct`,
 * `usePaymentMethod`). One counter across the whole module so distinct
 * hooks observing the same transport share the id space.
 */
const transportIds = new WeakMap<object, number>()
let nextTransportId = 0

function transportIdFor(transport: object): number {
  let id = transportIds.get(transport)
  if (id === undefined) {
    id = ++nextTransportId
    transportIds.set(transport, id)
  }
  return id
}

/**
 * Build a stable cache key for transport-keyed single-flight caches.
 *
 * When `config.transport` is present, the key is `transport:<id>[:<suffix>]`
 * where `<id>` is assigned lazily and is stable for the lifetime of the
 * transport instance. Distinct transports get distinct ids. The optional
 * `suffix` scopes the key further (for example, by `productRef` in
 * `useProduct`) so one transport can cache multiple values independently.
 *
 * When no custom transport is configured, the key falls back to exactly
 * `fallbackRoute` so HTTP consumers key off the configured route path
 * (preserving legacy behavior). `suffix` applies only in transport mode —
 * callers that need scoping without a transport should bake it into
 * `fallbackRoute` themselves (see `useProduct`).
 */
export function createTransportCacheKey(
  config: SolvaPayConfig | undefined,
  fallbackRoute: string,
  suffix?: string,
): string {
  const transport = config?.transport
  if (transport) {
    const id = transportIdFor(transport)
    return suffix ? `transport:${id}:${suffix}` : `transport:${id}`
  }
  return fallbackRoute
}
