[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / PlanSelector

# Variable: PlanSelector

> `const` **PlanSelector**: `React.FC`\<[`PlanSelectorProps`](../interfaces/PlanSelectorProps.md)\>

Defined in: [packages/react/src/components/PlanSelector.tsx:52](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/components/PlanSelector.tsx#L52)

Headless Plan Selector Component

Provides plan selection logic with complete styling control via render props.
Integrates plan fetching, subscription status, and selection state management.

Features:
- Fetches and manages plans
- Tracks selected plan
- Provides helpers for checking if plan is current/paid
- Integrates with subscription context

## Example

```tsx
<PlanSelector
  agentRef="agent_123"
  fetcher={async (agentRef) => {
    const res = await fetch(`/api/list-plans?agentRef=${agentRef}`);
    const data = await res.json();
    return data.plans;
  }}
  sortBy={(a, b) => (a.price || 0) - (b.price || 0)}
  autoSelectFirstPaid
>
  {({ plans, selectedPlan, setSelectedPlanIndex, loading, isPaidPlan, isCurrentPlan }) => (
    <div>
      {loading ? (
        <div>Loading plans...</div>
      ) : (
        plans.map((plan, index) => (
          <button
            key={plan.reference}
            onClick={() => setSelectedPlanIndex(index)}
            disabled={!isPaidPlan(plan.name)}
          >
            {plan.name} - ${plan.price}
            {isCurrentPlan(plan.name) && ' (Current)'}
          </button>
        ))
      )}
    </div>
  )}
</PlanSelector>
```
