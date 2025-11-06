[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / SolvaPay

# Interface: SolvaPay

Defined in: [packages/server/src/factory.ts:192](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L192)

SolvaPay instance with payable method and common API methods.

This interface provides the main API for interacting with SolvaPay.
Use `createSolvaPay()` to create an instance.

## Example

```typescript
const solvaPay = createSolvaPay();

// Create payable handlers
const payable = solvaPay.payable({ agent: 'agt_myapi', plan: 'pln_premium' });

// Manage customers
const customerRef = await solvaPay.ensureCustomer('user_123', 'user_123', {
  email: 'user@example.com'
});

// Create payment intents
const intent = await solvaPay.createPaymentIntent({
  agentRef: 'agt_myapi',
  planRef: 'pln_premium',
  customerRef: 'user_123'
});
```

## Properties

### apiClient

> **apiClient**: [`SolvaPayClient`](SolvaPayClient.md)

Defined in: [packages/server/src/factory.ts:513](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L513)

Direct access to the API client for advanced operations.

Use this for operations not exposed by the SolvaPay interface,
such as agent/plan management or custom API calls.

#### Example

```typescript
// Access API client directly for custom operations
const agents = await solvaPay.apiClient.listAgents();
```

## Methods

### checkLimits()

> **checkLimits**(`params`): `Promise`\<\{ `checkoutUrl?`: `string`; `plan`: `string`; `remaining`: `number`; `withinLimits`: `boolean`; \}\>

Defined in: [packages/server/src/factory.ts:339](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L339)

Check if customer is within usage limits for an agent.

This method checks subscription status and usage limits without
executing business logic. Use `payable()` for automatic protection.

#### Parameters

##### params

Limit check parameters

###### agentRef

`string`

Agent reference

###### customerRef

`string`

Customer reference

#### Returns

`Promise`\<\{ `checkoutUrl?`: `string`; `plan`: `string`; `remaining`: `number`; `withinLimits`: `boolean`; \}\>

Limit check result with remaining usage and checkout URL if needed

#### Example

```typescript
const limits = await solvaPay.checkLimits({
  customerRef: 'user_123',
  agentRef: 'agt_myapi'
});

if (!limits.withinLimits) {
  // Redirect to checkout
  window.location.href = limits.checkoutUrl;
}
```

***

### createCheckoutSession()

> **createCheckoutSession**(`params`): `Promise`\<\{ `checkoutUrl`: `string`; `sessionId`: `string`; \}\>

Defined in: [packages/server/src/factory.ts:464](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L464)

Create a hosted checkout session for a customer.

This creates a Stripe Checkout session that redirects the customer
to a hosted payment page. After payment, customer is redirected back.

#### Parameters

##### params

Checkout session parameters

###### agentRef

`string`

Agent reference

###### customerRef

`string`

Customer reference

###### planRef?

`string`

Optional plan reference (if not specified, shows plan selector)

###### returnUrl?

`string`

URL to redirect to after successful payment

#### Returns

`Promise`\<\{ `checkoutUrl`: `string`; `sessionId`: `string`; \}\>

Checkout session with redirect URL

#### Example

```typescript
const session = await solvaPay.createCheckoutSession({
  agentRef: 'agt_myapi',
  customerRef: 'user_123',
  planRef: 'pln_premium',
  returnUrl: 'https://myapp.com/success'
});

// Redirect customer to checkout
window.location.href = session.checkoutUrl;
```

***

### createCustomer()

> **createCustomer**(`params`): `Promise`\<\{ `customerRef`: `string`; \}\>

Defined in: [packages/server/src/factory.ts:409](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L409)

Create a new customer in SolvaPay backend.

Note: `ensureCustomer()` is usually preferred as it's idempotent.
Use this only if you need explicit control over customer creation.

#### Parameters

##### params

Customer creation parameters

###### email

`string`

Customer email address (required)

###### name?

`string`

Optional customer name

#### Returns

`Promise`\<\{ `customerRef`: `string`; \}\>

Created customer reference

#### Example

```typescript
const { customerRef } = await solvaPay.createCustomer({
  email: 'user@example.com',
  name: 'John Doe'
});
```

***

### createCustomerSession()

> **createCustomerSession**(`params`): `Promise`\<\{ `customerUrl`: `string`; `sessionId`: `string`; \}\>

Defined in: [packages/server/src/factory.ts:494](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L494)

Create a customer portal session for managing subscriptions.

This creates a Stripe Customer Portal session that allows customers
to manage their subscriptions, update payment methods, and view invoices.

#### Parameters

##### params

Customer session parameters

###### customerRef

`string`

Customer reference

#### Returns

`Promise`\<\{ `customerUrl`: `string`; `sessionId`: `string`; \}\>

Customer portal session with redirect URL

#### Example

```typescript
const session = await solvaPay.createCustomerSession({
  customerRef: 'user_123'
});

// Redirect customer to portal
window.location.href = session.customerUrl;
```

***

### createPaymentIntent()

> **createPaymentIntent**(`params`): `Promise`\<\{ `accountId?`: `string`; `clientSecret`: `string`; `id`: `string`; `publishableKey`: `string`; \}\>

Defined in: [packages/server/src/factory.ts:268](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L268)

Create a Stripe payment intent for a customer to subscribe to a plan.

This creates a payment intent that can be confirmed on the client side
using Stripe.js. After confirmation, call `processPayment()` to complete
the subscription.

#### Parameters

##### params

Payment intent parameters

###### agentRef

`string`

Agent reference

###### customerRef

`string`

Customer reference

###### idempotencyKey?

`string`

Optional idempotency key for retry safety

###### planRef

`string`

Plan reference to subscribe to

#### Returns

`Promise`\<\{ `accountId?`: `string`; `clientSecret`: `string`; `id`: `string`; `publishableKey`: `string`; \}\>

Payment intent with client secret and publishable key

#### Example

```typescript
const intent = await solvaPay.createPaymentIntent({
  agentRef: 'agt_myapi',
  planRef: 'pln_premium',
  customerRef: 'user_123',
  idempotencyKey: 'unique-key-123'
});

// Use intent.clientSecret with Stripe.js on client
```

***

### ensureCustomer()

> **ensureCustomer**(`customerRef`, `externalRef?`, `options?`): `Promise`\<`string`\>

Defined in: [packages/server/src/factory.ts:240](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L240)

Ensure customer exists in SolvaPay backend (idempotent).

Creates a customer if they don't exist, or returns existing customer reference.
This is automatically called by the paywall system, but you can call it
explicitly for setup or testing.

#### Parameters

##### customerRef

`string`

The customer reference used as a cache key (e.g., Supabase user ID)

##### externalRef?

`string`

Optional external reference for backend lookup (e.g., Supabase user ID).
  If provided, will lookup existing customer by externalRef before creating new one.
  The externalRef is stored on the SolvaPay backend for customer lookup.

##### options?

Optional customer details for customer creation

###### email?

`string`

Customer email address

###### name?

`string`

Customer name

#### Returns

`Promise`\<`string`\>

Customer reference (backend customer ID)

#### Example

```typescript
// Ensure customer exists before processing payment
const customerRef = await solvaPay.ensureCustomer(
  'user_123',           // customerRef (your user ID)
  'user_123',           // externalRef (same or different)
  {
    email: 'user@example.com',
    name: 'John Doe'
  }
);
```

***

### getCustomer()

> **getCustomer**(`params`): `Promise`\<[`CustomerResponseMapped`](../type-aliases/CustomerResponseMapped.md)\>

Defined in: [packages/server/src/factory.ts:434](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L434)

Get customer details including subscriptions and usage.

Returns full customer information from the SolvaPay backend, including
all active subscriptions, usage history, and customer metadata.

#### Parameters

##### params

Customer lookup parameters

###### customerRef

`string`

Customer reference

#### Returns

`Promise`\<[`CustomerResponseMapped`](../type-aliases/CustomerResponseMapped.md)\>

Customer details with subscriptions and metadata

#### Example

```typescript
const customer = await solvaPay.getCustomer({
  customerRef: 'user_123'
});

console.log('Active subscriptions:', customer.subscriptions);
console.log('Email:', customer.email);
```

***

### payable()

> **payable**(`options?`): [`PayableFunction`](PayableFunction.md)

Defined in: [packages/server/src/factory.ts:209](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L209)

Create a payable handler with explicit adapters for different frameworks.

#### Parameters

##### options?

[`PayableOptions`](PayableOptions.md)

Payable options including agent and plan references

#### Returns

[`PayableFunction`](PayableFunction.md)

PayableFunction with framework-specific adapters

#### Example

```typescript
const payable = solvaPay.payable({ 
  agent: 'agt_myapi', 
  plan: 'pln_premium' 
});

app.post('/tasks', payable.http(createTask));
```

***

### processPayment()

> **processPayment**(`params`): `Promise`\<[`ProcessPaymentResult`](ProcessPaymentResult.md)\>

Defined in: [packages/server/src/factory.ts:308](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L308)

Process a payment intent after client-side Stripe confirmation.

Creates subscription or purchase immediately, eliminating webhook delay.
Call this after the client has confirmed the payment intent with Stripe.js.

#### Parameters

##### params

Payment processing parameters

###### agentRef

`string`

Agent reference

###### customerRef

`string`

Customer reference

###### paymentIntentId

`string`

Stripe payment intent ID from client confirmation

###### planRef?

`string`

Optional plan reference (if not in payment intent)

#### Returns

`Promise`\<[`ProcessPaymentResult`](ProcessPaymentResult.md)\>

Payment processing result with subscription details

#### Example

```typescript
// After client confirms payment with Stripe.js
const result = await solvaPay.processPayment({
  paymentIntentId: 'pi_1234567890',
  agentRef: 'agt_myapi',
  customerRef: 'user_123',
  planRef: 'pln_premium'
});

if (result.success) {
  console.log('Subscription created:', result.subscriptionRef);
}
```

***

### trackUsage()

> **trackUsage**(`params`): `Promise`\<`void`\>

Defined in: [packages/server/src/factory.ts:379](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L379)

Track usage for a customer action.

This is automatically called by the paywall system. You typically
don't need to call this manually unless implementing custom tracking.

#### Parameters

##### params

Usage tracking parameters

###### action?

`string`

Optional action name for analytics

###### actionDuration

`number`

Action duration in milliseconds

###### agentRef

`string`

Agent reference

###### customerRef

`string`

Customer reference

###### outcome

`"success"` \| `"paywall"` \| `"fail"`

Action outcome ('success', 'paywall', or 'fail')

###### planRef

`string`

Plan reference

###### requestId

`string`

Unique request ID

###### timestamp

`string`

ISO timestamp of the action

#### Returns

`Promise`\<`void`\>

#### Example

```typescript
await solvaPay.trackUsage({
  customerRef: 'user_123',
  agentRef: 'agt_myapi',
  planRef: 'pln_premium',
  outcome: 'success',
  action: 'api_call',
  requestId: 'req_123',
  actionDuration: 150,
  timestamp: new Date().toISOString()
});
```
