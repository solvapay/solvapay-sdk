import { useMemo } from 'react'
import { SolvaPayProvider } from '@solvapay/react'
import { createSolvaPayConfig } from './lib/solvapay-config'

export function Providers({ children }: { children: React.ReactNode }) {
  const config = useMemo(() => createSolvaPayConfig(), [])
  return <SolvaPayProvider config={config}>{children}</SolvaPayProvider>
}
