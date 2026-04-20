import type { SolvaPayConfig } from '../types'
import { defaultAuthAdapter, type AuthAdapter } from '../adapters/auth'

const CUSTOMER_REF_KEY = 'solvapay_customerRef'
const CUSTOMER_REF_EXPIRY = 'solvapay_customerRef_expiry'
const CUSTOMER_REF_USER_ID_KEY = 'solvapay_customerRef_userId'

export function getAuthAdapter(config: SolvaPayConfig | undefined): AuthAdapter {
  if (config?.auth?.adapter) {
    return config.auth.adapter
  }

  return defaultAuthAdapter
}

export function getCachedCustomerRef(userId?: string | null): string | null {
  if (typeof window === 'undefined') return null

  const cached = localStorage.getItem(CUSTOMER_REF_KEY)
  const expiry = localStorage.getItem(CUSTOMER_REF_EXPIRY)
  const cachedUserId = localStorage.getItem(CUSTOMER_REF_USER_ID_KEY)

  if (!cached || !expiry) return null

  if (Date.now() > parseInt(expiry)) {
    localStorage.removeItem(CUSTOMER_REF_KEY)
    localStorage.removeItem(CUSTOMER_REF_EXPIRY)
    localStorage.removeItem(CUSTOMER_REF_USER_ID_KEY)
    return null
  }

  if (userId !== undefined && userId !== null) {
    if (cachedUserId !== userId) {
      clearCachedCustomerRef()
      return null
    }
  }

  return cached
}

const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

export function setCachedCustomerRef(customerRef: string, userId?: string | null): void {
  if (typeof window === 'undefined') return

  if (userId === undefined || userId === null) {
    return
  }

  localStorage.setItem(CUSTOMER_REF_KEY, customerRef)
  localStorage.setItem(CUSTOMER_REF_EXPIRY, String(Date.now() + CACHE_DURATION))
  localStorage.setItem(CUSTOMER_REF_USER_ID_KEY, userId)
}

export function clearCachedCustomerRef(): void {
  if (typeof window === 'undefined') return

  localStorage.removeItem(CUSTOMER_REF_KEY)
  localStorage.removeItem(CUSTOMER_REF_EXPIRY)
  localStorage.removeItem(CUSTOMER_REF_USER_ID_KEY)
}

/**
 * Build the standard request headers for SolvaPay API calls.
 *
 * Resolves auth token, cached customer ref, and any custom headers from config
 * in one place so every provider method stays DRY.
 */
export async function buildRequestHeaders(
  config: SolvaPayConfig | undefined,
): Promise<{ headers: HeadersInit; userId: string | null }> {
  const adapter = getAuthAdapter(config)
  const token = await adapter.getToken()
  const userId = await adapter.getUserId()
  const cachedRef = getCachedCustomerRef(userId)

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  if (cachedRef) {
    headers['x-solvapay-customer-ref'] = cachedRef
  }

  if (config?.headers) {
    const custom =
      typeof config.headers === 'function' ? await config.headers() : config.headers
    Object.assign(headers, custom)
  }

  return { headers, userId }
}
