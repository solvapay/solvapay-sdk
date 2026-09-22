'use client'

/**
 * `useCustomerSessionUrl()` — internal hook that resolves the SolvaPay
 * hosted customer-portal URL for the current transport.
 *
 * Multiple components inside the same `<SolvaPayProvider>` share a single
 * in-flight `transport.createCustomerSession()` call, keyed by transport
 * identity via a module-scoped `WeakMap`. The first consumer to mount
 * kicks off the fetch; later consumers attach to the same promise via
 * `useSyncExternalStore` and re-render together when it resolves.
 *
 * `ensure()` is the click-time accessor — returns the cached URL or
 * starts (or awaits) an in-flight request. It also retries on the
 * `error` state so a transient failure on first paint doesn't strand
 * the button. `refresh()` forces a fresh fetch (e.g. after the customer
 * has updated their default card and the cached portal session has
 * expired).
 *
 * The hook itself is render-pure: it does not throw and does not gate
 * the render path. Components are expected to render an enabled UI on
 * every status, falling back to a click-time `ensure()` when the URL
 * isn't ready yet.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useTransport } from './useTransport'
import type { SolvaPayTransport } from '../transport/types'

export type CustomerSessionStatus = 'idle' | 'loading' | 'ready' | 'error'

interface SessionSnapshot {
  status: CustomerSessionStatus
  url?: string
  error?: Error
}

class SessionStore {
  // Snapshot is replaced (not mutated) on every transition so
  // `useSyncExternalStore` sees a fresh reference and schedules
  // a re-render for every subscriber.
  state: SessionSnapshot = { status: 'idle' }
  private inflight: Promise<string> | null = null
  private readonly listeners = new Set<() => void>()

  constructor(private readonly transport: SolvaPayTransport) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): SessionSnapshot => this.state

  ensure = (): Promise<string> => {
    if (this.state.status === 'ready' && this.state.url) {
      return Promise.resolve(this.state.url)
    }
    return this.start()
  }

  refresh = (): Promise<string> => {
    this.inflight = null
    this.state = { status: 'idle' }
    this.notify()
    return this.start()
  }

  private start(): Promise<string> {
    if (this.inflight) return this.inflight

    this.state = { status: 'loading' }
    this.notify()

    const promise = this.transport
      .createCustomerSession()
      .then(({ customerUrl }) => {
        this.state = { status: 'ready', url: customerUrl }
        this.inflight = null
        this.notify()
        return customerUrl
      })
      .catch((err: unknown) => {
        const error = err instanceof Error ? err : new Error(String(err))
        this.state = { status: 'error', error }
        this.inflight = null
        this.notify()
        throw error
      })

    this.inflight = promise
    return promise
  }

  private notify(): void {
    this.listeners.forEach(listener => listener())
  }
}

const stores = new WeakMap<SolvaPayTransport, SessionStore>()

function getStore(transport: SolvaPayTransport): SessionStore {
  let store = stores.get(transport)
  if (!store) {
    store = new SessionStore(transport)
    stores.set(transport, store)
  }
  return store
}

/** @internal Exposed only for tests — clears the per-transport cache. */
export function __resetCustomerSessionStore(transport: SolvaPayTransport): void {
  stores.delete(transport)
}

export interface CustomerSessionUrlState {
  status: CustomerSessionStatus
  url: string | undefined
  error: Error | undefined
  /**
   * Click-time accessor. Resolves with the cached URL when ready, joins
   * the in-flight promise when loading, or kicks off a fresh fetch when
   * the entry is idle or previously errored.
   */
  ensure: () => Promise<string>
  /**
   * Force a fresh fetch, replacing any cached URL. Use after the
   * customer has updated billing info and the previously-issued portal
   * session is stale.
   */
  refresh: () => Promise<string>
}

export function useCustomerSessionUrl(): CustomerSessionUrlState {
  const transport = useTransport()
  const store = getStore(transport)

  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    const current = getStore(transport)
    if (current.state.status === 'idle') {
      // Fire-and-forget: any error is recorded on the snapshot and
      // surfaces via the consumer's render path. ensure() callers
      // observe the same rejection through the shared promise.
      current.ensure().catch(() => {})
    }
  }, [transport])

  const ensure = useCallback((): Promise<string> => getStore(transport).ensure(), [transport])
  const refresh = useCallback((): Promise<string> => getStore(transport).refresh(), [transport])

  return {
    status: snapshot.status,
    url: snapshot.url,
    error: snapshot.error,
    ensure,
    refresh,
  }
}
