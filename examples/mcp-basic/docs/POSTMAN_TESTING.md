# Testing MCP Server with Postman

This guide explains how to test the SolvaPay MCP server using Postman with the **Streamable HTTP transport** (MCP spec 2025-11-25).

> **Updated**: This example now uses the official `@modelcontextprotocol/sdk` StreamableHTTPServerTransport which implements the current MCP specification. This means:
> 1. Single `/mcp` endpoint for all operations (POST/GET/DELETE)
> 2. Session management via `MCP-Session-Id` header (not query parameters)
> 3. Protocol version via `MCP-Protocol-Version` header
> 4. Responses can be sent via SSE stream or directly in HTTP response

## Prerequisites

1. **Start the server in HTTP mode**:
   
   We recommend using port **3003** to avoid conflicts with other local development servers (like Next.js on 3000).

   ```bash
   cd examples/mcp-basic
   MCP_TRANSPORT=http MCP_PORT=3003 pnpm dev
   ```

2. **Verify the server is running**:
   - Health check: `GET http://localhost:3003/health`

## Testing Flow

### Step 1: Initialize Session and Get Session ID

1. In Postman, create a new **POST** request to `http://localhost:3003/mcp`
2. **Headers**:
   - `Content-Type: application/json`
   - `Accept: application/json, text/event-stream`
   - `MCP-Protocol-Version: 2025-11-25`
3. **Body**:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 1,
     "method": "initialize",
     "params": {
       "protocolVersion": "2025-11-25",
       "capabilities": {},
       "clientInfo": { "name": "postman", "version": "1.0.0" }
     }
   }
   ```
4. **Send the request**
5. **Check the response headers** - Look for `MCP-Session-Id` header
6. **Copy the session ID** from the header
7. **Set the collection variable**:
   - Click the three dots (⋯) next to the collection name → **Edit**
   - Find the `session_id` variable
   - Paste your session ID into the **Current Value** field
   - Click **Save**
8. **Check the response body** - You should see the JSON-RPC initialize response

### Step 2: Open SSE Stream (Optional but Recommended)

1. Create a new **GET** request to `http://localhost:3003/mcp`
2. **Headers**:
   - `Accept: text/event-stream`
   - `MCP-Session-Id: <YOUR_SESSION_ID>` (from Step 1)
   - `MCP-Protocol-Version: 2025-11-25`
3. **Keep this request tab open** - You'll see server notifications and responses here
4. This stream allows you to receive server-initiated messages

### Step 3: Send JSON-RPC Messages

Now you can send commands using the session ID from Step 1.

**Base URL**: `http://localhost:3003/mcp`

#### List Tools

**Request:**
- **Method**: `POST`
- **URL**: `http://localhost:3003/mcp`
- **Headers**: 
  - `Content-Type: application/json`
  - `Accept: application/json, text/event-stream`
  - `MCP-Session-Id: <SESSION_ID>` (from Step 1)
  - `MCP-Protocol-Version: 2025-11-25`
- **Body**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }
  ```

**Response**: JSON-RPC response in the HTTP response body (or via SSE stream if stream was opened)

#### List Tools

**Request:**
- **Method**: `POST`
- **URL**: `http://localhost:3003/message?sessionId=<SESSION_ID>`
- **Body**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }
  ```

#### Call Tool (Create Task)

**Request:**
- **Method**: `POST`
- **URL**: `http://localhost:3003/mcp`
- **Headers**: 
  - `Content-Type: application/json`
  - `Accept: application/json, text/event-stream`
  - `MCP-Session-Id: <SESSION_ID>` (from Step 1)
  - `MCP-Protocol-Version: 2025-11-25`
- **Body**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "create_task",
      "arguments": {
        "title": "Test Task",
        "auth": { "customer_ref": "user_123" }
      }
    }
  }
  ```

## Testing Paywall

1. Make 3 requests (free tier) using the same `customer_ref`.
2. Make a 4th request with the same `customer_ref`.
3. Check the response. You should see a JSON-RPC error response like:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 4,
     "error": {
       "code": -32000,
       "message": "Payment required",
       "data": {
         "checkoutUrl": "...",
         "agent": "basic-crud",
         "remaining": 0
       }
     }
   }
   ```

## Troubleshooting

### "Invalid or missing session ID" Error

If you get a `400 Bad Request` with "Invalid or missing session ID":

1. **Check that you've completed Step 1**: Make sure you've initialized the session first
2. **Verify the session_id variable**: 
   - Go to collection settings (three dots → Edit)
   - Check that `session_id` has a value
   - The session ID should look like: `b9a8c7d6-e5f4-4321-9876-abcdef123456`
3. **Check the headers**: Make sure `MCP-Session-Id` header is included in your request
4. **Verify the URL**: Make sure you're using `http://localhost:3003/mcp` (not `/message`)

### "Invalid origin" Error

If you get a `403 Forbidden` with "Invalid origin":

- The server validates the `Origin` header for security
- Make sure your requests include a valid `Origin` header
- For localhost testing, use `Origin: http://localhost:3003` or omit it

### Session Expired

If your session expires:

- Re-initialize by sending a new `initialize` request (without `MCP-Session-Id` header)
- Copy the new session ID from the response headers
- Update the `session_id` variable

## Alternative: Testing with Curl

**Terminal 1 (Initialize and get session ID):**
```bash
# Initialize session
RESPONSE=$(curl -i -X POST "http://localhost:3003/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": {"name": "curl", "version": "1.0.0"}
    }
  }')

# Extract session ID from headers
SESSION_ID=$(echo "$RESPONSE" | grep -i "mcp-session-id" | cut -d' ' -f2 | tr -d '\r')
echo "Session ID: $SESSION_ID"
```

**Terminal 2 (Open SSE stream - optional):**
```bash
curl -N "http://localhost:3003/mcp" \
  -H "Accept: text/event-stream" \
  -H "MCP-Session-Id: $SESSION_ID" \
  -H "MCP-Protocol-Version: 2025-11-25"
```

**Terminal 3 (Send requests):**
```bash
# Replace SESSION_ID with the one from Terminal 1
curl -X POST "http://localhost:3003/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Session-Id: $SESSION_ID" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'
```
