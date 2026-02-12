import { useSolvaPay } from './useSolvaPay'
import type { PurchaseStatus } from '../types'

/**
 * Hook to get current purchase status and information.
 *
 * Returns the current user's purchase status, including active
 * purchases, plan details, and payment information. Automatically
 * syncs with the SolvaPay backend and handles loading and error states.
 *
 * @returns Purchase data and status
 * @returns purchases - Array of active purchases
 * @returns hasPaidPurchase - Whether user has any paid purchase
 * @returns isLoading - Loading state
 * @returns error - Error state if purchase check fails
 * @returns refetch - Function to manually refetch purchase data
 *
 * @example
 * ```tsx
 * import { usePurchase } from '@solvapay/react';
 *
 * function Dashboard() {
 *   const { purchases, hasPaidPurchase, isLoading, refetch } = usePurchase();
 *
 *   if (isLoading) return <Spinner />;
 *
 *   if (!hasPaidPurchase) {
 *     return <UpgradePrompt />;
 *   }
 *
 *   return (
 *     <div>
 *       <h2>Welcome, Premium User!</h2>
 *       <p>Active purchases: {purchases.length}</p>
 *       <button onClick={() => refetch()}>Refresh</button>
 *     </div>
 *   );
 * }
 * ```
 *
 * @see {@link SolvaPayProvider} for required context provider
 * @see {@link usePurchaseStatus} for detailed status information
 * @since 1.0.0
 */
export function usePurchase(): PurchaseStatus & { refetch: () => Promise<void> } {
  const { purchase, refetchPurchase } = useSolvaPay()

  return {
    ...purchase,
    refetch: refetchPurchase,
  }
}
