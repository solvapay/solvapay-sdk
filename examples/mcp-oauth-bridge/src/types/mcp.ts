export interface MCPToolArgs {
  [key: string]: unknown
  _auth?: {
    customer_ref?: string
  }
}

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
