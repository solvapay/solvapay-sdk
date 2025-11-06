[**SolvaPay SDK**](../../../README.md)

***

[SolvaPay SDK](../../../modules.md) / [server/src](../README.md) / verifyWebhook

# Function: verifyWebhook()

> **verifyWebhook**(`params`): `any`

Defined in: [packages/server/src/index.ts:66](https://github.com/solvapay/solvapay-sdk/blob/main/packages/server/src/index.ts#L66)

Verify webhook signature from SolvaPay backend.

This function verifies that a webhook request is authentic by comparing
the provided signature with a computed HMAC-SHA256 signature of the request body.
Uses timing-safe comparison to prevent timing attacks.

## Parameters

### params

Webhook verification parameters

#### body

`string`

Raw request body as string (must be exactly as received)

#### secret

`string`

Webhook secret from SolvaPay dashboard

#### signature

`string`

Signature from `x-solvapay-signature` header

## Returns

`any`

Parsed webhook payload as object

## Throws

If signature is invalid

## Example

```typescript
import { verifyWebhook } from '@solvapay/server';

// In Express.js
app.post('/webhooks/solvapay', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const signature = req.headers['x-solvapay-signature'] as string;
    const payload = verifyWebhook({
      body: req.body.toString(),
      signature,
      secret: process.env.SOLVAPAY_WEBHOOK_SECRET!
    });
    
    // Handle webhook event
    if (payload.type === 'subscription.created') {
      // Process subscription creation
    }
    
    res.json({ received: true });
  } catch (error) {
    res.status(401).json({ error: 'Invalid signature' });
  }
});
```

## See

[Webhook Guide](../guides/webhooks.md) for complete webhook handling examples

## Since

1.0.0
