import { useContext } from 'react'
import { SolvaPayContext } from '../SolvaPayProvider'
import type { SolvaPayContextValue } from '../types'

/**
 * Hook to access SolvaPay context and provider methods.
 *
 * This is the base hook that provides access to all SolvaPay functionality
 * including purchase data, payment methods, and customer information.
 * Other hooks like `usePurchase` and `useCheckout` use this internally.
 *
 * Must be used within a `SolvaPayProvider` component.
 *
 * @returns SolvaPay context value with all provider methods and state
 * @returns purchase - Purchase status and data
 * @returns createPayment - Function to create payment intents
 * @returns processPayment - Function to process payments
 * @returns customerRef - Current customer reference
 * @returns refetchPurchase - Function to refetch purchase data
 *
 * @example
 * ```tsx
 * import { useSolvaPay } from '@solvapay/react';
 *
 * function CustomComponent() {
 *   const { purchase, createPayment, processPayment } = useSolvaPay();
 *
 *   const handlePayment = async () => {
 *     const intent = await createPayment({
 *       planRef: 'pln_premium',
 *       agentRef: 'agt_myapi'
 *     });
 *     // Process payment...
 *   };
 *
 *   return <div>Purchase status: {purchase.hasPaidPurchase ? 'Active' : 'None'}</div>;
 * }
 * ```
 *
 * @throws {Error} If used outside of SolvaPayProvider
 * @see {@link SolvaPayProvider} for required context provider
 * @see {@link usePurchase} for purchase-specific hook
 * @see {@link useCheckout} for checkout-specific hook
 * @since 1.0.0
 */
export function useSolvaPay(): SolvaPayContextValue {
  const context = useContext(SolvaPayContext)

  if (!context) {
    throw new Error(
      'useSolvaPay must be used within a SolvaPayProvider. ' +
        'Wrap your component tree with <SolvaPayProvider> to use this hook.',
    )
  }

  return context
}
