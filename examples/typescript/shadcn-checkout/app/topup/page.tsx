'use client'

/**
 * Topup page (demo-only; not part of the canonical 4 registry files for
 * PR 7). Client-only so Next prerender does not call formatPrice before
 * browser WASM is installed.
 */

import dynamic from 'next/dynamic'

const TopupClient = dynamic(() => import('./topup-client').then(mod => mod.TopupClient), {
  ssr: false,
})

export default function TopupPage() {
  return <TopupClient />
}
