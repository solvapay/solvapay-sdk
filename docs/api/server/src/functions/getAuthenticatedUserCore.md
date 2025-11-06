[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / getAuthenticatedUserCore

# Function: getAuthenticatedUserCore()

> **getAuthenticatedUserCore**(`request`, `options`): `Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md) \| [`AuthenticatedUser`](../interfaces/AuthenticatedUser.md)\>

Defined in: [packages/server/src/helpers/auth.ts:46](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/helpers/auth.ts#L46)

Extract authenticated user information from a standard Web API Request.

This is a generic, framework-agnostic helper that extracts user ID, email,
and name from authenticated requests. Works with any framework that uses
the standard Web API Request (Express, Fastify, Next.js, Edge Functions, etc.).

Uses dynamic imports to avoid requiring @solvapay/auth at build time,
making it suitable for edge runtime environments.

## Parameters

### request

`Request`

Standard Web API Request object

### options

Configuration options

#### includeEmail?

`boolean`

Whether to extract email from JWT token (default: true)

#### includeName?

`boolean`

Whether to extract name from JWT token (default: true)

## Returns

`Promise`\<[`ErrorResult`](../interfaces/ErrorResult.md) \| [`AuthenticatedUser`](../interfaces/AuthenticatedUser.md)\>

Authenticated user info or error result

## Example

```typescript
// In an API route handler
export async function GET(request: Request) {
  const userResult = await getAuthenticatedUserCore(request);
  
  if (isErrorResult(userResult)) {
    return Response.json(userResult, { status: userResult.status });
  }
  
  const { userId, email, name } = userResult;
  // Use user info...
}
```

## See

 - [AuthenticatedUser](../interfaces/AuthenticatedUser.md) for the return type
 - [ErrorResult](../interfaces/ErrorResult.md) for error handling

## Since

1.0.0
