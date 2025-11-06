[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / SubscriptionGate

# Variable: SubscriptionGate

> `const` **SubscriptionGate**: `React.FC`\<[`SubscriptionGateProps`](../interfaces/SubscriptionGateProps.md)\>

Defined in: [packages/react/src/components/SubscriptionGate.tsx:23](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/components/SubscriptionGate.tsx#L23)

Headless Subscription Gate Component

Controls access to content based on subscription status.
Uses render props to give developers full control over locked/unlocked states.

## Example

```tsx
<SubscriptionGate requirePlan="Pro Plan">
  {({ hasAccess, loading }) => {
    if (loading) return <Skeleton />;
    if (!hasAccess) return <Paywall />;
    return <PremiumContent />;
  }}
</SubscriptionGate>
```
