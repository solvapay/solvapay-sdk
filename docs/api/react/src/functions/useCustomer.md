[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [react/src](../README.md) / useCustomer

# Function: useCustomer()

> **useCustomer**(): [`CustomerInfo`](../interfaces/CustomerInfo.md)

Defined in: [packages/react/src/hooks/useCustomer.ts:45](https://github.com/solvapay/solvapay-sdk/blob/main/packages/react/src/hooks/useCustomer.ts#L45)

Hook to access customer information
Returns customer data (email, name, customerRef) separate from subscription data

## Returns

[`CustomerInfo`](../interfaces/CustomerInfo.md)

## Example

```tsx
import { useCustomer } from '@solvapay/react';

function MyComponent() {
  const { email, name, customerRef } = useCustomer();
  
  return (
    <div>
      <p>Email: {email || 'Not provided'}</p>
      <p>Name: {name || 'Not provided'}</p>
    </div>
  );
}
```
