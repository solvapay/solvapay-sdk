import { useSolvaPay } from './useSolvaPay'

/**
 * Customer information interface
 */
export interface CustomerInfo {
  /**
   * Customer reference ID
   */
  customerRef?: string
  /**
   * Customer email address
   */
  email?: string
  /**
   * Customer name
   */
  name?: string
  /**
   * Whether customer data is currently loading
   */
  loading: boolean
}

/**
 * Hook to access customer information
 * Returns customer data (email, name, customerRef) separate from purchase data
 *
 * @example
 * ```tsx
 * import { useCustomer } from '@solvapay/react';
 *
 * function MyComponent() {
 *   const { email, name, customerRef } = useCustomer();
 *
 *   return (
 *     <div>
 *       <p>Email: {email || 'Not provided'}</p>
 *       <p>Name: {name || 'Not provided'}</p>
 *     </div>
 *   );
 * }
 * ```
 */
export function useCustomer(): CustomerInfo {
  const { purchase, customerRef } = useSolvaPay()

  return {
    customerRef: purchase.customerRef || customerRef,
    email: purchase.email,
    name: purchase.name,
    loading: purchase.loading,
  }
}
