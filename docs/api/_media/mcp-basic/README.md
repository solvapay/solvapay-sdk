# SolvaPay MCP Basic Example

This example demonstrates how to integrate SolvaPay paywall functionality with an MCP (Model Context Protocol) server using persistent storage simulation.

## Features

### 🔒 **Agent-Based Access Control**
- Uses `agent` to identify the service/tool suite
- Supports both free tier and paid plan access
- Backend-configurable plans (no hardcoded pricing in SDK)

### 📊 **Persistent Free Tier Tracking**
- **Production-ready demo**: Free tier usage persists across server restarts
- **File-based storage**: Simulates database persistence using JSON files
- **Daily reset logic**: Automatically resets counters each day
- **Concurrent safe**: Handles multiple API calls properly

### 📈 **Usage Analytics**
- Tracks feature usage with `trackUsage()` (not tied to plans)
- Clean separation: Plans control access, features track usage
- Perfect foundation for usage-based pricing models

## How Persistence Works

### **Demo Implementation (Current)**
```typescript
// Data stored in .demo-data/ directory
.demo-data/
├── customers.json      // Customer data and credits
└── free-tier-usage.json // Daily usage tracking per customer/agent/endpoint
```

### **Production Implementation (Required)**
In production, the SolvaPay backend would handle persistence:

```typescript
// Backend API handles all persistence
POST /api/check-limits
POST /api/track-usage  
POST /api/create-checkout
```

## Key Benefits

✅ **Server restart resilience** - Free tier counts persist  
✅ **Multi-instance compatible** - Shared storage approach  
✅ **Development realistic** - Mirrors production behavior  
✅ **Alpha launch ready** - Transparent about requirements  

## Running the Example

### Prerequisites
```bash
pnpm install
```

### Run the MCP Server
```bash
pnpm start
```

### Run Tests
```bash
# Run all tests
pnpm test

# Run just API client tests
npx vitest run src/__tests__/api-client.test.ts

# Clean test data between runs
rm -rf .demo-data
```

### See Persistence in Action

1. **Start the server** and make some API calls
2. **Stop the server** 
3. **Check the data files**:
   ```bash
   cat .demo-data/customers.json
   cat .demo-data/free-tier-usage.json
   ```
4. **Restart the server** - usage counts will be remembered!

## Configuration

### Agent-Based Configuration
```typescript
const paywallMetadata = {
  agent: 'basic-crud'          // Agent identifier
};
```

### Endpoint-Specific Metering
```typescript
// Different endpoints can use different agents
const tools = [
  { agent: 'list-api' },       // List operations
  { agent: 'ai-analyzer' },    // AI analysis
  { agent: 'premium-api' }     // Premium features
];
```

## Production Considerations

### **Required for Production**
1. **Database persistence** - Replace file-based storage
2. **Distributed locks** - For concurrent access safety
3. **Rate limiting** - Additional protection
4. **Monitoring** - Track usage patterns and errors

### **Recommended for Production**
1. **Redis caching** - Fast access to usage counts
2. **Event sourcing** - Audit trail of all usage
3. **Backup strategy** - Don't lose usage data
4. **Analytics integration** - Business intelligence

## Architecture

```
MCP Client → MCP Server → SolvaPay SDK → Demo Storage
                                      ↓
Production: MCP Server → SolvaPay SDK → SolvaPay API → Database
```

This demo shows exactly how the production flow would work, just with local file storage instead of a remote API and database.

## API Reference

See the main SolvaPay SDK documentation for the complete API reference. This example uses:

- `checkLimits()` - Plan access control with persistent free tier
- `trackUsage()` - Feature usage analytics  
- `createCheckoutSession()` - Payment flow initiation
- `getOrCreateCustomer()` - Customer management