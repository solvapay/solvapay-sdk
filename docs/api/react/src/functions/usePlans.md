[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / usePlans

# Function: usePlans()

> **usePlans**(`options`): [`UsePlansReturn`](../interfaces/UsePlansReturn.md)

Defined in: [packages/react/src/hooks/usePlans.ts:34](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/hooks/usePlans.ts#L34)

Hook to manage plan fetching and selection

Provides a reusable way to fetch, filter, sort and select subscription plans.
Handles loading and error states automatically.
Uses a global cache to prevent duplicate fetches when multiple components use the same agentRef.

## Parameters

### options

[`UsePlansOptions`](../interfaces/UsePlansOptions.md)

## Returns

[`UsePlansReturn`](../interfaces/UsePlansReturn.md)

## Example

```tsx
const plans = usePlans({
  agentRef: 'agent_123',
  fetcher: async (agentRef) => {
    const res = await fetch(`/api/list-plans?agentRef=${agentRef}`);
    const data = await res.json();
    return data.plans;
  },
  sortBy: (a, b) => (a.price || 0) - (b.price || 0),
  autoSelectFirstPaid: true,
});

// Use in component
if (plans.loading) return <div>Loading...</div>;
if (plans.error) return <div>Error: {plans.error.message}</div>;
```
