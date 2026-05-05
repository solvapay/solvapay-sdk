import React, { useMemo } from 'react'
import { SolvaPayProvider } from '@solvapay/react'
import { createAnonymousAuthAdapter, getAnonymousCustomerRef } from './anonymousCustomer'

interface ProvidersProps {
  children: React.ReactNode
}

export const Providers: React.FC<ProvidersProps> = ({ children }) => {
  const customerRef = useMemo(() => getAnonymousCustomerRef(), [])
  const adapter = useMemo(() => createAnonymousAuthAdapter(customerRef), [customerRef])

  const headers = useMemo<Record<string, string>>(
    () => ({ 'x-customer-ref': customerRef }),
    [customerRef],
  )

  return (
    <SolvaPayProvider
      config={{
        auth: { adapter },
        headers,
      }}
    >
      {children}
    </SolvaPayProvider>
  )
}
