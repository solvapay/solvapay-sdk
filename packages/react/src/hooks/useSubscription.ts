import { useSolvaPay } from './useSolvaPay';
import type { SubscriptionStatus } from '../types';

/**
 * Hook to access subscription status
 * Returns the current subscription state and a refetch function
 */
export function useSubscription(): SubscriptionStatus & { refetch: () => Promise<void> } {
  const { subscription, refetchSubscription } = useSolvaPay();
  
  return {
    ...subscription,
    refetch: refetchSubscription,
  };
}

