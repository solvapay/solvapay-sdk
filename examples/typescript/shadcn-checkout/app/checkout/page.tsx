'use client'

/**
 * Canonical registry file (4/4).
 *
 * Client-only so Next prerender does not call formatPrice before
 * browser WASM is installed.
 */

import dynamic from 'next/dynamic'

const CheckoutClient = dynamic(() => import('./checkout-client').then(mod => mod.CheckoutClient), {
  ssr: false,
})

export default function CheckoutPage() {
  return <CheckoutClient />
}
