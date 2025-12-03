# Testing MCP Server with Postman

This guide explains how to test the SolvaPay MCP server using Postman.

## Prerequisites

1. **Start the server in HTTP mode**:
   ```bash
   cd examples/mcp-basic
   MCP_TRANSPORT=http MCP_PORT=3000 pnpm dev
   ```

   Or create a `.env` file:
   ```env
   MCP_TRANSPORT=http
   MCP_PORT=3000
   MCP_HOST=localhost
   ```

2. **Verify the server is running**:
   - Health check: `GET http://localhost:3000/health`
   - Server info: `GET http://localhost:3000/`

## Postman Setup

### Base Configuration

- **Base URL**: `http://localhost:3000`
- **MCP Endpoint**: `http://localhost:3000/mcp`

### Required Headers

For all MCP requests, include these headers:

```
Content-Type: application/json
MCP-Protocol-Version: 2025-11-25
Accept: application/json
```

After initialization, also include:
```
MCP-Session-Id: <session-id-from-initialize-response>
```

## Step-by-Step Testing

### Step 1: Initialize the MCP Session

**Request:**
- **Method**: `POST`
- **URL**: `http://localhost:3000/mcp`
- **Headers**:
  ```
  Content-Type: application/json
  MCP-Protocol-Version: 2025-11-25
  Accept: application/json
  ```
- **Body** (raw JSON):
  ```json
  {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": {
        "name": "postman-client",
        "version": "1.0.0"
      }
    }
  }
  ```

**Response:**
- Status: `200 OK`
- Headers: Look for `MCP-Session-Id` in the response headers
- Body: JSON response with server capabilities

**Important**: Copy the `MCP-Session-Id` from the response headers for subsequent requests.

### Step 2: List Available Tools

**Request:**
- **Method**: `POST`
- **URL**: `http://localhost:3000/mcp`
- **Headers**:
  ```
  Content-Type: application/json
  MCP-Protocol-Version: 2025-11-25
  Accept: application/json
  MCP-Session-Id: <session-id-from-step-1>
  ```
- **Body** (raw JSON):
  ```json
  {
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }
  ```

**Response:**
- Should return a list of available tools: `create_task`, `get_task`, `list_tasks`, `delete_task`

### Step 3: Call a Tool (Within Free Tier)

**Request:**
- **Method**: `POST`
- **URL**: `http://localhost:3000/mcp`
- **Headers**:
  ```
  Content-Type: application/json
  MCP-Protocol-Version: 2025-11-25
  Accept: application/json
  MCP-Session-Id: <session-id>
  ```
- **Body** (raw JSON) - Create Task:
  ```json
  {
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "create_task",
      "arguments": {
        "title": "Test Task from Postman",
        "description": "This is a test task created via Postman",
        "auth": {
          "customer_ref": "user_123"
        }
      }
    }
  }
  ```

**Response:**
- Should return success with task details

### Step 4: Test Other Tools

#### List Tasks
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "list_tasks",
    "arguments": {
      "limit": 10,
      "offset": 0,
      "auth": {
        "customer_ref": "user_123"
      }
    }
  }
}
```

#### Get Task
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "get_task",
    "arguments": {
      "id": "<task-id-from-create>",
      "auth": {
        "customer_ref": "user_123"
      }
    }
  }
}
```

#### Delete Task
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "delete_task",
    "arguments": {
      "id": "<task-id-to-delete>",
      "auth": {
        "customer_ref": "user_123"
      }
    }
  }
}
```

### Step 5: Test Paywall (After Free Tier Limit)

After making 3 requests (the free tier limit), the next request should return a paywall error:

**Request**: Same as Step 3 (create_task)

**Expected Response**:
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "error": {
    "code": -32000,
    "message": "Payment required",
    "data": {
      "checkoutUrl": "https://checkout.solvapay.com/...",
      "agent": "basic-crud",
      "remaining": 0
    }
  }
}
```

## Postman Collection Setup

### Creating a Postman Collection

1. **Create a new Collection** named "SolvaPay MCP Server"

2. **Set Collection Variables**:
   - `base_url`: `http://localhost:3000`
   - `mcp_endpoint`: `{{base_url}}/mcp`
   - `session_id`: (will be set automatically)

3. **Create Requests**:

   #### Request 1: Initialize
   - Name: `1. Initialize Session`
   - Method: `POST`
   - URL: `{{mcp_endpoint}}`
   - Headers:
     - `Content-Type`: `application/json`
     - `MCP-Protocol-Version`: `2025-11-25`
     - `Accept`: `application/json`
   - Body: Use the initialize JSON from Step 1
   - **Tests Tab** (to save session ID):
     ```javascript
     if (pm.response.headers.get("MCP-Session-Id")) {
         pm.collectionVariables.set("session_id", pm.response.headers.get("MCP-Session-Id"));
     }
     ```

   #### Request 2: List Tools
   - Name: `2. List Tools`
   - Method: `POST`
   - URL: `{{mcp_endpoint}}`
   - Headers:
     - `Content-Type`: `application/json`
     - `MCP-Protocol-Version`: `2025-11-25`
     - `Accept`: `application/json`
     - `MCP-Session-Id`: `{{session_id}}`
   - Body: Use the tools/list JSON from Step 2

   #### Request 3: Create Task
   - Name: `3. Create Task`
   - Method: `POST`
   - URL: `{{mcp_endpoint}}`
   - Headers:
     - `Content-Type`: `application/json`
     - `MCP-Protocol-Version`: `2025-11-25`
     - `Accept`: `application/json`
     - `MCP-Session-Id`: `{{session_id}}`
   - Body: Use the create_task JSON from Step 3
   - **Tests Tab** (to save task ID):
     ```javascript
     const response = pm.response.json();
     if (response.result && response.result.content && response.result.content[0]) {
         const task = JSON.parse(response.result.content[0].text);
         if (task.task && task.task.id) {
             pm.collectionVariables.set("task_id", task.task.id);
         }
     }
     ```

   #### Request 4: List Tasks
   - Name: `4. List Tasks`
   - Method: `POST`
   - URL: `{{mcp_endpoint}}`
   - Headers: Same as Request 3
   - Body: Use the list_tasks JSON from Step 4

   #### Request 5: Get Task
   - Name: `5. Get Task`
   - Method: `POST`
   - URL: `{{mcp_endpoint}}`
   - Headers: Same as Request 3
   - Body: Use the get_task JSON from Step 4, with `{{task_id}}` variable

   #### Request 6: Delete Task
   - Name: `6. Delete Task`
   - Method: `POST`
   - URL: `{{mcp_endpoint}}`
   - Headers: Same as Request 3
   - Body: Use the delete_task JSON from Step 4, with `{{task_id}}` variable

## Testing Paywall

To test the paywall:

1. **Reset free tier** (if needed):
   ```bash
   rm -rf .demo-data
   ```

2. **Make 3 requests** using the same `customer_ref` (e.g., "user_123")

3. **Make a 4th request** - should return paywall error with checkout URL

4. **Try different customer_ref** (e.g., "user_456") - should have fresh free tier

## Server-Sent Events (SSE) Testing

For SSE streaming, change the `Accept` header to:
```
Accept: application/json, text/event-stream
```

Postman will display the SSE stream in the response. Note that Postman's SSE support may be limited - for full SSE testing, consider using `curl` or a dedicated SSE client.

## Troubleshooting

### Server Not Responding
- Check server is running: `GET http://localhost:3000/health`
- Verify `MCP_TRANSPORT=http` is set
- Check console logs for errors

### Session ID Not Working
- Make sure to initialize first
- Copy the `MCP-Session-Id` from response headers exactly
- Sessions expire after inactivity (default timeout)

### Paywall Not Triggering
- Verify you're using the same `customer_ref` in `auth.customer_ref`
- Check that you've made 3+ requests (free tier limit)
- Review server console logs for debug information

### CORS Errors
- If testing from browser, ensure `MCP_ALLOWED_ORIGINS` includes your origin
- Postman typically doesn't have CORS issues

## Example cURL Commands

For reference, here are equivalent cURL commands:

```bash
# Initialize
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Accept: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-11-25",
      "capabilities": {},
      "clientInfo": {"name": "curl-client", "version": "1.0.0"}
    }
  }' \
  -i

# List Tools (replace SESSION_ID)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Accept: application/json" \
  -H "MCP-Session-Id: SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }'

# Create Task (replace SESSION_ID)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Accept: application/json" \
  -H "MCP-Session-Id: SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "create_task",
      "arguments": {
        "title": "Test Task",
        "auth": {"customer_ref": "user_123"}
      }
    }
  }'
```

