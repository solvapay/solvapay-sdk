/**
 * TypeScript types for MCP paywall functionality
 */

export interface MCPToolArgs {
  [key: string]: any
  auth?: {
    customer_ref?: string
  }
}

// Specific tool argument types
export interface CreateTaskArgs extends MCPToolArgs {
  title: string
  description?: string
}

export interface GetTaskArgs extends MCPToolArgs {
  id: string
}

export interface ListTasksArgs extends MCPToolArgs {
  limit?: number
  offset?: number
}

export interface DeleteTaskArgs extends MCPToolArgs {
  id: string
}

export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource'
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
  structuredContent?: {
    kind: 'payment_required'
    agent: string
    checkoutUrl: string
    message: string
  }
}

export type MCPToolHandler = (args: MCPToolArgs) => Promise<MCPToolResult>

// Generic tool handler type for specific operations
export type MCPToolHandlerGeneric<T extends MCPToolArgs> = (args: T) => Promise<MCPToolResult>

// Deprecated types - kept for backward compatibility but not used with new API
// Use PaywallMetadata from @solvapay/server instead

// Import SolvaPayClient from SDK
export type { SolvaPayClient } from '@solvapay/server'

// CRUD Task types
export interface Task {
  id: string
  title: string
  description?: string
  completed: boolean
  createdAt: string
  updatedAt: string
}
