# Core Concepts

Understanding the key concepts in SolvaPay SDK will help you build effective monetization strategies.

## Agents and Plans

### Agents

An **Agent** represents your API, service, or application that you want to monetize. Each agent has:

- **Agent Reference** (`agt_...`) - Unique identifier for your agent
- **Name** - Human-readable name
- **Description** - What the agent does

Agents are created in the SolvaPay dashboard and represent the service you're protecting.

```typescript
// All endpoints for this agent share the same paywall rules
const payable = solvaPay.payable({
  agent: 'agt_myapi', // Your agent reference
})
```

### Plans

A **Plan** represents a subscription tier or pricing model. Plans define:

- **Plan Reference** (`pln_...`) - Unique identifier for the plan
- **Name** - Plan name (e.g., "Premium", "Pro")
- **Price** - Subscription price
- **Usage Limits** - What's included (e.g., 1000 API calls/month)
- **Features** - What features are available

Plans are created in the SolvaPay dashboard and can be associated with agents.

```typescript
// Protect endpoints with a specific plan requirement
const payable = solvaPay.payable({
  agent: 'agt_myapi',
  plan: 'pln_premium', // Users need this plan to access
})
```

### Agent-Plan Relationship

- **One agent can have multiple plans** - Different tiers (Free, Pro, Enterprise)
- **Plans can be shared across agents** - Reuse plans for multiple services
- **Paywall checks** - Verify user has the required plan for the agent

## Customer References

### What is a Customer Reference?

A **Customer Reference** (`customerRef`) is a unique identifier for a user in your system. It's used to:

- Track usage per customer
- Check subscription status
- Enforce usage limits
- Create payment intents

### How Customer References Work

1. **Customer Creation**: When a user first interacts with your protected endpoints, SolvaPay automatically creates a customer record
2. **External Reference**: You can link SolvaPay customers to your user IDs using `externalRef`
3. **Customer Lookup**: SolvaPay uses the customer reference to check subscriptions and track usage

```typescript
// Ensure customer exists (creates if doesn't exist)
const customerRef = await solvaPay.ensureCustomer(
  'user_123', // customerRef (your user ID)
  'user_123', // externalRef (same or different)
  {
    email: 'user@example.com',
    name: 'John Doe',
  },
)
```

### Customer Reference in Requests

For HTTP adapters, pass the customer reference via headers:

```typescript
// Express.js example
app.post(
  '/tasks',
  payable.http(async req => {
    const customerRef = req.headers['x-customer-ref']
    // Business logic here
  }),
)
```

For Next.js, the customer reference is automatically extracted from authentication:

```typescript
// Next.js automatically extracts from auth middleware
const result = await checkSubscription(request)
// result.customerRef is automatically set
```

## Paywall Protection Flow

### How Paywall Protection Works

When you wrap your business logic with `payable()`, SolvaPay automatically:

1. **Extracts Customer Reference** - From headers, auth tokens, or request context
2. **Checks Subscription Status** - Verifies if customer has required plan
3. **Checks Usage Limits** - Verifies if customer is within usage limits
4. **Executes Business Logic** - If checks pass, runs your function
5. **Tracks Usage** - Records the usage for billing/analytics
6. **Returns Paywall Error** - If checks fail, returns error with checkout URL

### Paywall Flow Diagram

```
Request → Extract Customer Ref → Check Subscription
                                    ↓
                              Has Subscription?
                                    ↓
                              Yes → Check Usage Limits
                                    ↓
                              Within Limits?
                                    ↓
                              Yes → Execute Business Logic
                                    ↓
                              Track Usage → Return Result
                                    ↓
                              No → Return Paywall Error
                                    ↓
                              (with checkout URL)
```

### Paywall Error Response

When a paywall is triggered, SolvaPay returns a structured error:

```typescript
{
  error: 'PaywallError',
  message: 'Subscription required',
  checkoutUrl: 'https://checkout.solvapay.com/...',
  // Additional metadata for custom UI
}
```

You can customize the error handling:

```typescript
try {
  const result = await handler(req)
  return result
} catch (error) {
  if (error instanceof PaywallError) {
    // Custom paywall handling
    return res.status(402).json({
      error: error.message,
      checkoutUrl: error.checkoutUrl,
    })
  }
  throw error
}
```

## Subscription Lifecycle

### Subscription States

Subscriptions can be in different states:

- **Active** - Subscription is active and can be used
- **Cancelled** - Subscription is cancelled but still active until end date
- **Expired** - Subscription has expired
- **Past Due** - Payment failed, subscription is past due

### Subscription Management

```typescript
// Check subscription status
const customer = await solvaPay.getCustomer({ customerRef: 'user_123' })
const subscriptions = customer.subscriptions

// Cancel subscription
await solvaPay.cancelSubscription({
  customerRef: 'user_123',
  subscriptionRef: 'sub_...',
})
```

### Free Tier

All agents support a **free tier** with limited usage:

- **Free Tier Limits** - Set in SolvaPay dashboard (e.g., 100 calls/month)
- **No Subscription Required** - Free tier works without payment
- **Automatic Upgrade Prompt** - When limits are exceeded, users see checkout URL

## Authentication Flow

### How Authentication Works

SolvaPay SDK integrates with your existing authentication system:

1. **Extract User ID** - From auth tokens, headers, or session
2. **Map to Customer Reference** - User ID becomes customer reference
3. **Sync Customer Data** - Email, name, etc. synced to SolvaPay
4. **Check Subscription** - Verify subscription status

### Authentication Adapters

SolvaPay provides adapters for common auth systems:

```typescript
// Supabase adapter
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase'

const adapter = new SupabaseAuthAdapter({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_ANON_KEY,
})

// Extract user ID from Supabase JWT
const userId = adapter.getUserId(request)
```

### Next.js Authentication

Next.js helpers automatically extract user info:

```typescript
import { getAuthenticatedUser } from '@solvapay/next'

// Automatically extracts userId, email, name from Supabase JWT
const user = await getAuthenticatedUser(request)
// { userId: '...', email: '...', name: '...' }
```

## Usage Tracking

### Automatic Usage Tracking

SolvaPay automatically tracks usage when you use `payable()`:

- **Per Request** - Each protected request is tracked
- **Per Customer** - Usage is tracked per customer reference
- **Per Agent** - Usage is tracked per agent
- **Per Plan** - Usage limits are enforced per plan

### Manual Usage Tracking

You can also track usage manually:

```typescript
// Track custom usage
await solvaPay.trackUsage({
  customerRef: 'user_123',
  agentRef: 'agt_myapi',
  amount: 1, // Usage amount
  metadata: {
    /* custom data */
  },
})
```

### Usage Limits

Usage limits are enforced automatically:

- **Plan Limits** - Set in SolvaPay dashboard
- **Free Tier Limits** - Automatic for all customers
- **Custom Limits** - Can be set per customer

## Next Steps

- [Quick Start](./quick-start.md) - Try the examples
- [Framework Guides](../guides/express.md) - Framework-specific integration
- [API Reference](../api/) - Complete API documentation
