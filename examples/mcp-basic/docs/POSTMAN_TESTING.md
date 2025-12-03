# Testing MCP Server with Postman

This guide explains how to test the SolvaPay MCP server using Postman.

> **⚠️ Important Change**: This example now uses the official `@modelcontextprotocol/sdk` which implements the standard MCP HTTP/SSE transport. This means:
> 1. You must keep an **SSE (Server-Sent Events) connection open** to receive responses.
> 2. `POST` requests now return `202 Accepted` immediately (empty body).
> 3. Actual JSON-RPC responses are sent asynchronously over the SSE connection.

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

Testing requires two parallel operations:
1. **Listening**: A long-lived connection to receive events.
2. **Sending**: Individual HTTP POST requests to trigger actions.

### Step 1: Establish SSE Connection and Get Session ID

1. In Postman, open the collection and run **"1. Connect SSE (Get Session ID)"**.
2. **Keep this request tab open** - you'll see a stream of events in the response body.
3. Look for the first event that looks like:
   ```
   event: endpoint
   data: /message?sessionId=b9a8c7d6-e5f4-4321-9876-abcdef123456
   ```
4. **Copy the sessionId** - in the example above, it's `b9a8c7d6-e5f4-4321-9876-abcdef123456` (the part after `sessionId=`).
5. **Set the collection variable**:
   - Click the three dots (⋯) next to the collection name → **Edit**
   - Find the `session_id` variable
   - Paste your copied session ID into the **Current Value** field
   - Click **Save**
6. **Alternative**: Check the Postman Console (View → Show Postman Console) - the test script may have automatically extracted it.

⚠️ **Important**: The SSE connection must stay open for you to receive responses to your POST requests!

### Step 2: Send JSON-RPC Messages

Now you can send commands using the session ID from Step 1.

**Base URL**: `http://localhost:3003/message?sessionId=<YOUR_SESSION_ID>`

#### Initialize

**Request:**
- **Method**: `POST`
- **URL**: `http://localhost:3003/message?sessionId=<SESSION_ID>`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "postman", "version": "1.0.0" }
    }
  }
  ```

**Response (HTTP)**: `202 Accepted`
**Response (SSE Stream)**: Look at your Step 1 tab to see the JSON-RPC response.

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
- **URL**: `http://localhost:3003/message?sessionId=<SESSION_ID>`
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

Since responses come via SSE, you'll need to watch the stream to see the paywall error.

1. Make 3 requests (free tier).
2. Make a 4th request.
3. Check the SSE stream. You should see a response like:
   ```json
   {
     "jsonrpc": "2.0",
     "id": 4,
     "result": {
       "content": [{
         "type": "text",
         "text": "{\"error\":\"Payment required\",\"checkoutUrl\":\"...\"}"
       }],
       "isError": true
     }
   }
   ```

## Troubleshooting

### "Session not found" Error

If you get a `404 Session not found` error when trying to initialize:

1. **Check that you've completed Step 1**: Make sure you've run the "1. Connect SSE" request first
2. **Verify the session_id variable**: 
   - Go to collection settings (three dots → Edit)
   - Check that `session_id` has a value (not empty, not "REPLACE_WITH_ID_FROM_SSE")
   - The session ID should look like: `b9a8c7d6-e5f4-4321-9876-abcdef123456`
3. **Check the SSE connection**: The "1. Connect SSE" request must still be running/open
4. **Verify the URL**: Make sure `base_url` is set to `http://localhost:3003`
5. **Check Postman Console**: View → Show Postman Console to see if the test script extracted the session ID

### SSE Connection Closed

If responses stop appearing:
- The SSE connection may have timed out
- Re-run "1. Connect SSE" to get a new session ID
- Update the `session_id` variable with the new ID

### No Response in SSE Stream

- Make sure the "1. Connect SSE" request tab is still open
- Check that the server is running: `GET http://localhost:3003/health`
- Look at the server console logs for errors

## Alternative: Testing with Curl

It is often easier to test SSE with `curl` in a terminal:

**Terminal 1 (Listen):**
```bash
curl -N -H "Accept: text/event-stream" http://localhost:3003/mcp
```

**Terminal 2 (Send):**
```bash
# Replace SESSION_ID with the one from Terminal 1
curl -X POST "http://localhost:3003/message?sessionId=SESSION_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "curl", "version": "1.0.0"}
    }
  }'
```
