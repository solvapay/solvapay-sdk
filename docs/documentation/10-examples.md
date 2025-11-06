# Example JSDoc Comments

## Function Example

```typescript
/**
 * Create a SolvaPay instance with paywall protection capabilities.
 * 
 * This factory function creates a SolvaPay instance that can be used to
 * protect API endpoints, functions, and MCP tools with usage limits and
 * subscription checks.
 * 
 * @param config - Optional configuration object
 * @param config.apiKey - API key for production use (defaults to `SOLVAPAY_SECRET_KEY` env var)
 * @param config.apiClient - Custom API client for testing or advanced use cases
 * @param config.apiBaseUrl - Optional API base URL override
 * @returns SolvaPay instance with payable() method and API client access
 * 
 * @example
 * ```typescript
 * // Production: Use environment variable (recommended)
 * const solvaPay = createSolvaPay();
 * 
 * // Production: Pass API key explicitly
 * const solvaPay = createSolvaPay({
 *   apiKey: process.env.SOLVAPAY_SECRET_KEY
 * });
 * 
 * // Testing: Use mock client
 * const solvaPay = createSolvaPay({
 *   apiClient: mockClient
 * });
 * ```
 * 
 * @see {@link SolvaPay} for the returned instance interface
 * @see {@link CreateSolvaPayConfig} for configuration options
 * @since 1.0.0
 */
export function createSolvaPay(config?: CreateSolvaPayConfig): SolvaPay {
  // Implementation
}
```

## Component Example

```typescript
/**
 * Payment form component for handling Stripe checkout.
 * 
 * This component provides a complete payment form with Stripe integration,
 * including card input, plan selection, and payment processing. It handles
 * the entire checkout flow including payment intent creation and confirmation.
 * 
 * @example
 * ```tsx
 * import { PaymentForm } from '@solvapay/react';
 * 
 * function CheckoutPage() {
 *   return (
 *     <PaymentForm
 *       planRef="pln_premium"
 *       agentRef="agt_myapi"
 *       onSuccess={() => {
 *         console.log('Payment successful!');
 *         router.push('/dashboard');
 *       }}
 *       onError={(error) => {
 *         console.error('Payment failed:', error);
 *       }}
 *     />
 *   );
 * }
 * ```
 * 
 * @param props - Payment form configuration
 * @param props.planRef - Plan reference to subscribe to
 * @param props.agentRef - Agent reference for usage tracking
 * @param props.onSuccess - Callback when payment succeeds
 * @param props.onError - Callback when payment fails
 * @param props.showPlanDetails - Whether to show plan details (default: true)
 * 
 * @see {@link useCheckout} for programmatic checkout handling
 * @see {@link SolvaPayProvider} for required context provider
 */
export function PaymentForm(props: PaymentFormProps) {
  // Implementation
}
```

## Hook Example

```typescript
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
 * 
 * @example
 * ```tsx
 * import { useSubscription } from '@solvapay/react';
 * 
 * function Dashboard() {
 *   const { subscriptions, hasPaidSubscription, isLoading } = useSubscription();
 * 
 *   if (isLoading) return <Spinner />;
 * 
 *   if (!hasPaidSubscription) {
 *     return <UpgradePrompt />;
 *   }
 * 
 *   return <PremiumContent subscriptions={subscriptions} />;
 * }
 * ```
 * 
 * @see {@link SolvaPayProvider} for required context provider
 * @see {@link useSubscriptionStatus} for detailed status information
 */
export function useSubscription(): UseSubscriptionReturn {
  // Implementation
}
```

