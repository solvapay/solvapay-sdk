# Webhook Handling

This guide shows you how to handle SolvaPay webhooks to keep your application in sync with subscription and payment events.

## Table of Contents

- [Overview](#overview)
- [Webhook Setup](#webhook-setup)
- [Webhook Verification](#webhook-verification)
- [Event Handling](#event-handling)
- [Complete Examples](#complete-examples)

## Overview

SolvaPay sends webhooks to notify your application about important events:

- **Subscription Created** - New subscription activated
- **Subscription Updated** - Subscription plan or status changed
- **Subscription Cancelled** - Subscription cancelled
- **Payment Succeeded** - Payment processed successfully
- **Payment Failed** - Payment processing failed

### Webhook Flow

```
SolvaPay Backend
    ↓
Webhook Event
    ↓
Your Webhook Endpoint
    ↓
Verify Signature
    ↓
Process Event
    ↓
Update Your Database
```

## Webhook Setup

### 1. Configure Webhook Endpoint

Set your webhook endpoint in the SolvaPay dashboard:

```
https://your-app.com/api/webhooks/solvapay
```

### 2. Create Webhook Endpoint

Create an endpoint to receive webhooks:

```typescript
// app/api/webhooks/solvapay/route.ts (Next.js)
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhook } from '@solvapay/server';

export async function POST(request: NextRequest) {
  try {
    // Verify webhook signature
    const payload = await request.text();
    const signature = request.headers.get('x-solvapay-signature');
    
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }
    
    const verified = verifyWebhook(payload, signature, {
      secret: process.env.SOLVAPAY_WEBHOOK_SECRET!,
    });
    
    if (!verified) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }
    
    // Parse event
    const event = JSON.parse(payload);
    
    // Handle event
    await handleWebhookEvent(event);
    
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
```

### Express.js Webhook Endpoint

```typescript
// routes/webhooks.ts
import express from 'express';
import { verifyWebhook } from '@solvapay/server';

const router = express.Router();

router.post('/solvapay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-solvapay-signature'] as string;
    
    if (!signature) {
      return res.status(401).json({ error: 'Missing signature' });
    }
    
    const payload = req.body.toString();
    const verified = verifyWebhook(payload, signature, {
      secret: process.env.SOLVAPAY_WEBHOOK_SECRET!,
    });
    
    if (!verified) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    const event = JSON.parse(payload);
    await handleWebhookEvent(event);
    
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;
```

## Webhook Verification

### Verify Webhook Signature

Always verify webhook signatures to ensure requests are from SolvaPay:

```typescript
import { verifyWebhook } from '@solvapay/server';

const verified = verifyWebhook(payload, signature, {
  secret: process.env.SOLVAPAY_WEBHOOK_SECRET!,
});

if (!verified) {
  // Reject webhook
  return res.status(401).json({ error: 'Invalid signature' });
}
```

### Environment Variables

Set your webhook secret:

```env
SOLVAPAY_WEBHOOK_SECRET=whsec_...
```

Get your webhook secret from the SolvaPay dashboard.

## Event Handling

### Event Types

Handle different event types:

```typescript
interface WebhookEvent {
  type: string;
  data: {
    customerRef: string;
    subscriptionId?: string;
    planRef?: string;
    status?: string;
    // ... other event data
  };
  timestamp: string;
}
```

### Handle Subscription Events

```typescript
async function handleWebhookEvent(event: WebhookEvent) {
  switch (event.type) {
    case 'subscription.created':
      await handleSubscriptionCreated(event.data);
      break;
    
    case 'subscription.updated':
      await handleSubscriptionUpdated(event.data);
      break;
    
    case 'subscription.cancelled':
      await handleSubscriptionCancelled(event.data);
      break;
    
    case 'payment.succeeded':
      await handlePaymentSucceeded(event.data);
      break;
    
    case 'payment.failed':
      await handlePaymentFailed(event.data);
      break;
    
    default:
      console.log('Unknown event type:', event.type);
  }
}
```

### Subscription Created

```typescript
async function handleSubscriptionCreated(data: any) {
  const { customerRef, subscriptionId, planRef } = data;
  
  // Update your database
  await db.subscriptions.create({
    customerRef,
    subscriptionId,
    planRef,
    status: 'active',
  });
  
  // Clear subscription cache
  await clearSubscriptionCache(customerRef);
  
  // Send welcome email, etc.
  await sendWelcomeEmail(customerRef);
}
```

### Subscription Updated

```typescript
async function handleSubscriptionUpdated(data: any) {
  const { customerRef, subscriptionId, planRef, status } = data;
  
  // Update subscription in database
  await db.subscriptions.update({
    where: { subscriptionId },
    data: { planRef, status },
  });
  
  // Clear cache
  await clearSubscriptionCache(customerRef);
}
```

### Subscription Cancelled

```typescript
async function handleSubscriptionCancelled(data: any) {
  const { customerRef, subscriptionId } = data;
  
  // Update subscription status
  await db.subscriptions.update({
    where: { subscriptionId },
    data: { status: 'cancelled', cancelledAt: new Date() },
  });
  
  // Clear cache
  await clearSubscriptionCache(customerRef);
  
  // Send cancellation email
  await sendCancellationEmail(customerRef);
}
```

### Payment Succeeded

```typescript
async function handlePaymentSucceeded(data: any) {
  const { customerRef, paymentIntentId, amount } = data;
  
  // Record payment
  await db.payments.create({
    customerRef,
    paymentIntentId,
    amount,
    status: 'succeeded',
  });
  
  // Clear cache
  await clearSubscriptionCache(customerRef);
}
```

### Payment Failed

```typescript
async function handlePaymentFailed(data: any) {
  const { customerRef, paymentIntentId, error } = data;
  
  // Record failed payment
  await db.payments.create({
    customerRef,
    paymentIntentId,
    status: 'failed',
    error: error.message,
  });
  
  // Notify user
  await sendPaymentFailedEmail(customerRef, error);
}
```

## Complete Examples

### Next.js Complete Example

```typescript
// app/api/webhooks/solvapay/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhook } from '@solvapay/server';
import { clearSubscriptionCache } from '@solvapay/next';

export async function POST(request: NextRequest) {
  try {
    // Get raw body for signature verification
    const payload = await request.text();
    const signature = request.headers.get('x-solvapay-signature');
    
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }
    
    // Verify webhook signature
    const verified = verifyWebhook(payload, signature, {
      secret: process.env.SOLVAPAY_WEBHOOK_SECRET!,
    });
    
    if (!verified) {
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }
    
    // Parse event
    const event = JSON.parse(payload);
    
    // Handle event
    await handleWebhookEvent(event);
    
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}

async function handleWebhookEvent(event: any) {
  const { type, data } = event;
  
  switch (type) {
    case 'subscription.created':
    case 'subscription.updated':
    case 'subscription.cancelled':
      // Clear subscription cache
      if (data.customerRef) {
        await clearSubscriptionCache(data.customerRef);
      }
      
      // Update database
      await updateSubscriptionInDatabase(data);
      break;
    
    case 'payment.succeeded':
    case 'payment.failed':
      // Handle payment events
      await handlePaymentEvent(type, data);
      break;
    
    default:
      console.log('Unknown event type:', type);
  }
}
```

### Express.js Complete Example

```typescript
// routes/webhooks.ts
import express from 'express';
import { verifyWebhook } from '@solvapay/server';
import { clearSubscriptionCache } from '@solvapay/next';

const router = express.Router();

// Important: Use express.raw() to get raw body for signature verification
router.post(
  '/solvapay',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const signature = req.headers['x-solvapay-signature'] as string;
      
      if (!signature) {
        return res.status(401).json({ error: 'Missing signature' });
      }
      
      const payload = req.body.toString();
      const verified = verifyWebhook(payload, signature, {
        secret: process.env.SOLVAPAY_WEBHOOK_SECRET!,
      });
      
      if (!verified) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
      
      const event = JSON.parse(payload);
      await handleWebhookEvent(event);
      
      res.json({ received: true });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

async function handleWebhookEvent(event: any) {
  const { type, data } = event;
  
  switch (type) {
    case 'subscription.created':
    case 'subscription.updated':
    case 'subscription.cancelled':
      if (data.customerRef) {
        await clearSubscriptionCache(data.customerRef);
      }
      await updateSubscriptionInDatabase(data);
      break;
    
    case 'payment.succeeded':
    case 'payment.failed':
      await handlePaymentEvent(type, data);
      break;
  }
}

export default router;
```

## Best Practices

1. **Always Verify Signatures**: Never process webhooks without verifying the signature.

2. **Use Idempotency**: Handle duplicate webhook deliveries gracefully.

3. **Process Asynchronously**: Process webhooks asynchronously to respond quickly.

4. **Log Events**: Log all webhook events for debugging and auditing.

5. **Handle Errors Gracefully**: Return appropriate status codes and log errors.

6. **Clear Caches**: Clear subscription caches when subscription events occur.

7. **Update Database**: Keep your database in sync with webhook events.

## Testing Webhooks

### Local Testing with ngrok

```bash
# Start your local server
npm run dev

# In another terminal, expose with ngrok
ngrok http 3000

# Use ngrok URL in SolvaPay dashboard webhook settings
```

### Test Webhook Payload

```typescript
// Test webhook locally
const testEvent = {
  type: 'subscription.created',
  data: {
    customerRef: 'user_123',
    subscriptionId: 'sub_123',
    planRef: 'pln_premium',
  },
  timestamp: new Date().toISOString(),
};

await handleWebhookEvent(testEvent);
```

## Next Steps

- [Error Handling Strategies](./error-handling.md) - Handle webhook errors
- [Next.js Integration Guide](./nextjs.md) - Next.js webhook setup
- [API Reference](../api/server/src/README.md) - Full API documentation

