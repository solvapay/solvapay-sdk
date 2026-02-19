# MCP Transport Implementation Review

## Executive Summary

**Status**: **Using Deprecated Transport Pattern**

The current implementation uses the **HTTP+SSE transport** pattern from MCP protocol version **2024-11-05**, which has been **deprecated** in favor of the **Streamable HTTP transport** pattern introduced in protocol version **2025-11-25**.

## Current Implementation Analysis

### What's Currently Implemented

The implementation uses the old HTTP+SSE pattern:

1. **GET `/mcp`** - Opens SSE stream, returns `endpoint` event with POST URL
2. **POST `/message?sessionId=...`** - Separate endpoint for sending JSON-RPC messages
3. Session management via query parameter (`sessionId`)

```typescript
// Current pattern (deprecated)
app.get('/mcp', async (req, res) => {
  const transport = new SSEServerTransport('/message', res)
  // Returns endpoint event: /message?sessionId=...
})

app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId as string
  // Handle message
})
```

### Issues Identified

#### 1. Using Deprecated Transport Pattern

The current implementation follows the **HTTP+SSE transport** from spec version **2024-11-05**, which is deprecated. According to the [MCP Transport Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports):

> This replaces the HTTP+SSE transport from protocol version 2024-11-05.

#### 2. Missing Required Headers

The new Streamable HTTP transport requires:

- **`MCP-Protocol-Version`** header - MUST be included on all HTTP requests
- **`MCP-Session-Id`** header - For session management (instead of query params)
- **`Accept`** header - MUST include `application/json` and `text/event-stream`

#### 3. Missing Security Requirements

According to the spec, servers **MUST**:

- Validate the `Origin` header to prevent DNS rebinding attacks
- Respond with HTTP 403 Forbidden for invalid origins
- Bind to localhost (127.0.0.1) when running locally (not 0.0.0.0)
- Implement proper authentication

#### 4. Incorrect Endpoint Structure

The new spec requires:

- **Single MCP endpoint** (e.g., `/mcp`) that handles both POST and GET
- POST to `/mcp` sends JSON-RPC messages directly (not to separate endpoint)
- GET to `/mcp` opens SSE stream for server-to-client messages

## Recommended Standard (2025-11-25)

### Streamable HTTP Transport Pattern

The new standard requires:

#### Single MCP Endpoint

```typescript
// Correct pattern (2025-11-25)
app.post('/mcp', async (req, res) => {
  // Handle JSON-RPC messages directly
  // Must check MCP-Protocol-Version header
  // Must check MCP-Session-Id header (if session exists)
  // Must validate Origin header
})

app.get('/mcp', async (req, res) => {
  // Open SSE stream for server-to-client messages
  // Must check MCP-Protocol-Version header
  // Must check MCP-Session-Id header (if session exists)
  // Must validate Origin header
})
```

#### Required Headers

1. **`MCP-Protocol-Version: 2025-11-25`** (or negotiated version)
   - MUST be included on all HTTP requests
   - Server MUST respond with 400 Bad Request if invalid/unsupported

2. **`MCP-Session-Id`** (for session management)
   - Assigned by server during initialization
   - Included in response header: `MCP-Session-Id: <session-id>`
   - Client MUST include in all subsequent requests
   - Server SHOULD respond with 400 Bad Request if missing (after init)

3. **`Accept: application/json, text/event-stream`**
   - MUST be included on POST requests
   - MUST include `text/event-stream` on GET requests

4. **`Origin`** (security)
   - Server MUST validate
   - Server MUST respond with 403 Forbidden if invalid

#### Message Flow

**POST Request Flow:**
1. Client sends POST to `/mcp` with JSON-RPC message in body
2. Server responds with:
   - `202 Accepted` (no body) for notifications/responses
   - `Content-Type: text/event-stream` to initiate SSE stream for requests
   - `Content-Type: application/json` for single JSON response
3. If SSE stream initiated, server sends response via SSE

**GET Request Flow:**
1. Client sends GET to `/mcp` to open SSE stream
2. Server responds with `Content-Type: text/event-stream`
3. Server can send JSON-RPC requests/notifications on stream
4. Server MUST NOT send responses unless resuming a stream

## SDK Compatibility Check

**Current SDK Version**: `@modelcontextprotocol/sdk@^0.5.0`  
**Latest SDK Version**: `@modelcontextprotocol/sdk@1.24.2`

### **SDK DOES Support New Pattern - Upgrade Required**

**Finding**: The SDK **does support** the new Streamable HTTP transport pattern, but you're using an **outdated version** (0.5.0) that only includes the deprecated `SSEServerTransport`.

**Evidence**:
1. **Current version (0.5.0)**: Only has `SSEServerTransport` - implements deprecated HTTP+SSE pattern
2. **Latest version (1.24.2)**: Includes `StreamableHTTPServerTransport` - implements new Streamable HTTP pattern (2025-11-25)

**Key Differences**:

| Feature | Old SDK (0.5.0) | New SDK (1.24.2) |
|---------|----------------|------------------|
| Transport Class | `SSEServerTransport` | `StreamableHTTPServerTransport` |
| Endpoint Pattern | Separate `/mcp` (GET) and `/message` (POST) | Single `/mcp` (POST/GET/DELETE) |
| Session Management | Query parameter (`?sessionId=...`) | Header (`MCP-Session-Id`) |
| Protocol Version | 2024-11-05 (deprecated) | 2025-11-25 (current) |

**Action Required**: 
1. **Upgrade SDK**: Update to `@modelcontextprotocol/sdk@^1.24.2`
2. **Replace Transport**: Use `StreamableHTTPServerTransport` instead of `SSEServerTransport`
3. **Update Implementation**: Follow the new pattern shown in SDK examples
4. **Add Headers**: Implement `MCP-Protocol-Version` and `MCP-Session-Id` header handling
5. **Add Security**: Implement `Origin` header validation

**Reference Implementation**: See `simpleStreamableHttp.ts` example in the SDK repository:
- Uses `StreamableHTTPServerTransport` 
- Single `/mcp` endpoint for POST/GET/DELETE
- Session management via headers
- Proper initialization flow

## Migration Path

### Option 1: Update to New Transport Pattern (Recommended)

1. **Update endpoint structure**:
   - Remove separate `/message` endpoint
   - Handle both POST and GET on `/mcp`

2. **Add header validation**:
   ```typescript
   // Validate Origin header
   const origin = req.headers.origin
   if (origin && !isValidOrigin(origin)) {
     return res.status(403).json({ error: 'Invalid origin' })
   }
   
   // Validate protocol version
   const protocolVersion = req.headers['mcp-protocol-version']
   if (!protocolVersion || !isSupportedVersion(protocolVersion)) {
     return res.status(400).json({ error: 'Invalid protocol version' })
   }
   ```

3. **Update session management**:
   - Use `MCP-Session-Id` header instead of query parameter
   - Return session ID in response header during initialization

4. **Update SDK usage**:
   - Check if `SSEServerTransport` supports new pattern
   - May need to use different transport class or configuration

### Option 2: Maintain Backwards Compatibility

If you need to support older clients:

1. Keep old endpoints (`/mcp` GET, `/message` POST) for backwards compatibility
2. Add new endpoints following the 2025-11-25 spec
3. Detect client version and route accordingly

## Security Recommendations

1. **Origin Validation**:
   ```typescript
   const allowedOrigins = ['http://localhost:3000', 'https://yourdomain.com']
   const origin = req.headers.origin
   if (origin && !allowedOrigins.includes(origin)) {
     return res.status(403).json({ error: 'Forbidden' })
   }
   ```

2. **Localhost Binding**:
   ```typescript
   // Good
   app.listen(port, '127.0.0.1', ...)
   
   // Bad (exposes to network)
   app.listen(port, '0.0.0.0', ...)
   ```

3. **Authentication**:
   - Implement proper authentication mechanism
   - Consider API keys, OAuth, or session tokens

## Testing Checklist

- [ ] POST to `/mcp` with JSON-RPC message works
- [ ] GET to `/mcp` opens SSE stream
- [ ] `MCP-Protocol-Version` header is validated
- [ ] `MCP-Session-Id` header is used for session management
- [ ] `Origin` header validation prevents DNS rebinding
- [ ] Server binds to localhost when running locally
- [ ] SSE stream properly handles disconnections
- [ ] Session resumption works with `Last-Event-ID`
- [ ] Backwards compatibility maintained (if needed)

## References

- [MCP Transport Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP Transport Specification (2024-11-05) - Deprecated](https://modelcontextprotocol.io/specification/2024-11-05/basic/transports#http-with-sse)
- [MCP Getting Started](https://modelcontextprotocol.io/docs/getting-started/intro)

## Next Steps

1. **SDK Support Verified**: Latest SDK (1.24.2) supports new pattern - upgrade required
2. **Upgrade SDK**: Update `package.json` to use `@modelcontextprotocol/sdk@^1.24.2`
3. **Update Implementation**: 
   - Replace `SSEServerTransport` with `StreamableHTTPServerTransport`
   - Update endpoint structure to single `/mcp` endpoint
   - Implement header-based session management
4. **Add Security**: Implement Origin validation and proper binding
5. **Update Documentation**: Update README and testing docs
6. **Test Thoroughly**: Ensure compatibility with MCP clients

## Migration Guide

### Step 1: Upgrade SDK

```bash
cd examples/mcp-basic
pnpm update @modelcontextprotocol/sdk@latest
```

### Step 2: Update Imports

```typescript
// Old (deprecated)
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

// New (current)
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
```

### Step 3: Update Server Implementation

See the reference implementation in the SDK examples for the complete pattern. Key changes:
- Use `StreamableHTTPServerTransport` with proper configuration
- Handle POST/GET/DELETE on single `/mcp` endpoint
- Use `MCP-Session-Id` header instead of query params
- Implement proper initialization flow

