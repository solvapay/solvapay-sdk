'use client'

import dynamic from 'next/dynamic'

const TopupClient = dynamic(
  () => import('./topup-client').then(mod => mod.TopupClient),
  { ssr: false },
)

export default function TopupPage() {
  return <TopupClient />
}
