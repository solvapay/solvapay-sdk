[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / PlanBadge

# Variable: PlanBadge

> `const` **PlanBadge**: `React.FC`\<[`PlanBadgeProps`](../interfaces/PlanBadgeProps.md)\>

Defined in: [packages/react/src/components/PlanBadge.tsx:33](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/components/PlanBadge.tsx#L33)

Headless Plan Badge Component

Displays subscription status with complete styling control.
Supports render props, custom components, or className patterns.

Prevents flickering by hiding the badge during initial load and when no subscription exists.
Shows the badge once loading completes AND an active subscription exists (paid or free).
Badge only updates when the plan name actually changes (prevents unnecessary re-renders).

Displays the primary active subscription (paid or free) to show current plan status.

## Example

```tsx
// Render prop pattern
<PlanBadge>
  {({ subscriptions, loading, displayPlan, shouldShow }) => (
    shouldShow ? (
      <div>{displayPlan}</div>
    ) : null
  )}
</PlanBadge>

//ClassName pattern
<PlanBadge className="badge badge-primary" />
```
