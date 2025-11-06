import { useSolvaPay } from './useSolvaPay';
import type { SubscriptionStatus } from '../types';

/**
 * Hook to get current subscription status and information.
 * 
 * Returns the current user's subscription status, including active
 * subscriptions, plan details, and payment information. Automatically
 * syncs with the SolvaPay backend and handles loading and error states.
 * 
 * @returns Subscription data and status
 * @returns subscriptions - Array of active subscriptions
 * @returns hasPaidSubscription - Whether user has any paid subscription
 * @returns isLoading - Loading state
 * @returns error - Error state if subscription check fails
 * @returns refetch - Function to manually refetch subscription data
 * 
 * @example
 * ```tsx
 * import { useSubscription } from '@solvapay/react';
 * 
 * function Dashboard() {
 *   const { subscriptions, hasPaidSubscription, isLoading, refetch } = useSubscription();
 * 
 *   if (isLoading) return <Spinner />;
 * 
 *   if (!hasPaidSubscription) {
 *     return <UpgradePrompt />;
 *   }
 * 
 *   return (
 *     <div>
 *       <h2>Welcome, Premium User!</h2>
 *       <p>Active subscriptions: {subscriptions.length}</p>
 *       <button onClick={() => refetch()}>Refresh</button>
 *     </div>
 *   );
 * }
 * ```
 * 
 * @see {@link SolvaPayProvider} for required context provider
 * @see {@link useSubscriptionStatus} for detailed status information
 * @since 1.0.0
 */
export function useSubscription(): SubscriptionStatus & { refetch: () => Promise<void> } {
  const { subscription, refetchSubscription } = useSolvaPay();
  
  return {
    ...subscription,
    refetch: refetchSubscription,
  };
}

