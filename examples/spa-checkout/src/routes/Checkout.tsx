import { CheckoutLayout } from '@solvapay/react'
import { useNavigate } from 'react-router-dom'

export function Checkout() {
  const navigate = useNavigate()
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <CheckoutLayout
        onResult={r => {
          if (r.kind === 'paid' || r.kind === 'activated') navigate('/dashboard')
        }}
      />
    </main>
  )
}
