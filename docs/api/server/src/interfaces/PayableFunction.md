[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / PayableFunction

# Interface: PayableFunction

Defined in: [packages/server/src/factory.ts:79](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L79)

Payable function that provides explicit adapters for different frameworks.

Use the appropriate adapter method for your framework:
- `http()` - Express.js, Fastify, and other HTTP frameworks
- `next()` - Next.js App Router API routes
- `mcp()` - Model Context Protocol servers
- `function()` - Pure functions, background jobs, or testing

## Example

```typescript
const payable = solvaPay.payable({ agent: 'agt_myapi', plan: 'pln_premium' });

// Express.js
app.post('/tasks', payable.http(createTask));

// Next.js
export const POST = payable.next(createTask);

// MCP Server
const handler = payable.mcp(createTask);

// Pure function
const protectedFn = await payable.function(createTask);
```

## Methods

### function()

> **function**\<`T`\>(`businessLogic`): `Promise`\<(`args`) => `Promise`\<`T`\>\>

Defined in: [packages/server/src/factory.ts:161](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L161)

Pure function adapter for direct function protection.

Use this for testing, background jobs, or non-framework contexts.

#### Type Parameters

##### T

`T` = `any`

#### Parameters

##### businessLogic

(`args`) => `Promise`\<`T`\>

Your business logic function

#### Returns

`Promise`\<(`args`) => `Promise`\<`T`\>\>

Protected function that requires customer reference in args

#### Example

```typescript
const protectedFn = await payable.function(async (args) => {
  return { result: 'processed' };
});

// Call with customer reference
const result = await protectedFn({
  auth: { customer_ref: 'user_123' },
  // ... other args
});
```

***

### http()

> **http**\<`T`\>(`businessLogic`, `options?`): (`req`, `reply`) => `Promise`\<`any`\>

Defined in: [packages/server/src/factory.ts:95](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L95)

HTTP adapter for Express.js, Fastify, and other HTTP frameworks.

#### Type Parameters

##### T

`T` = `any`

#### Parameters

##### businessLogic

(`args`) => `Promise`\<`T`\>

Your business logic function

##### options?

[`HttpAdapterOptions`](HttpAdapterOptions.md)

Optional adapter configuration

#### Returns

HTTP route handler function

> (`req`, `reply`): `Promise`\<`any`\>

##### Parameters

###### req

`any`

###### reply

`any`

##### Returns

`Promise`\<`any`\>

#### Example

```typescript
app.post('/tasks', payable.http(async (req) => {
  const { title } = req.body;
  return { success: true, task: { title } };
}));
```

***

### mcp()

> **mcp**\<`T`\>(`businessLogic`, `options?`): (`args`) => `Promise`\<`any`\>

Defined in: [packages/server/src/factory.ts:135](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L135)

MCP adapter for Model Context Protocol servers.

#### Type Parameters

##### T

`T` = `any`

#### Parameters

##### businessLogic

(`args`) => `Promise`\<`T`\>

Your tool implementation function

##### options?

[`McpAdapterOptions`](McpAdapterOptions.md)

Optional adapter configuration

#### Returns

MCP tool handler function

> (`args`): `Promise`\<`any`\>

##### Parameters

###### args

`any`

##### Returns

`Promise`\<`any`\>

#### Example

```typescript
const handler = payable.mcp(async (args) => {
  return { success: true, result: 'tool output' };
});
```

***

### next()

> **next**\<`T`\>(`businessLogic`, `options?`): (`request`, `context?`) => `Promise`\<`Response`\>

Defined in: [packages/server/src/factory.ts:116](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/factory.ts#L116)

Next.js adapter for App Router API routes.

#### Type Parameters

##### T

`T` = `any`

#### Parameters

##### businessLogic

(`args`) => `Promise`\<`T`\>

Your business logic function

##### options?

[`NextAdapterOptions`](NextAdapterOptions.md)

Optional adapter configuration

#### Returns

Next.js route handler function

> (`request`, `context?`): `Promise`\<`Response`\>

##### Parameters

###### request

`Request`

###### context?

`any`

##### Returns

`Promise`\<`Response`\>

#### Example

```typescript
// app/api/tasks/route.ts
export const POST = payable.next(async (request) => {
  const body = await request.json();
  return Response.json({ success: true });
});
```
