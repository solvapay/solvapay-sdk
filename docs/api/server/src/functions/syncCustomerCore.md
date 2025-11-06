[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / syncCustomerCore

# Function: syncCustomerCore()

> **syncCustomerCore**(`request`, `options`): `Promise`\<`string` \| [`ErrorResult`](../interfaces/ErrorResult.md)\>

Defined in: [packages/server/src/helpers/customer.ts:51](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/helpers/customer.ts#L51)

Sync customer with SolvaPay backend (ensure customer exists).

This helper ensures a customer exists in the SolvaPay backend by:
1. Extracting authenticated user information from the request
2. Creating or retrieving the customer using the user ID as external reference
3. Syncing customer data (email, name) if provided

Uses `externalRef` for consistent lookup and prevents duplicate customers.
The returned customer reference is the SolvaPay backend customer ID.

## Parameters

### request

`Request`

Standard Web API Request object

### options

Configuration options

#### includeEmail?

`boolean`

Whether to include email in customer data (default: true)

#### includeName?

`boolean`

Whether to include name in customer data (default: true)

#### solvaPay?

[`SolvaPay`](../interfaces/SolvaPay.md)

Optional SolvaPay instance (creates new one if not provided)

## Returns

`Promise`\<`string` \| [`ErrorResult`](../interfaces/ErrorResult.md)\>

Customer reference (backend customer ID) or error result

## Example

```typescript
// In an API route handler
export async function POST(request: Request) {
  const customerResult = await syncCustomerCore(request);
  
  if (isErrorResult(customerResult)) {
    return Response.json(customerResult, { status: customerResult.status });
  }
  
  const customerRef = customerResult;
  // Use customer reference...
}
```

## See

 - [getAuthenticatedUserCore](getAuthenticatedUserCore.md) for user extraction
 - [ErrorResult](../interfaces/ErrorResult.md) for error handling

## Since

1.0.0
