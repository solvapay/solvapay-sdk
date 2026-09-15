export interface CreateTaskArgs {
  title: string
  description?: string
}

export interface GetTaskArgs {
  id: string
}

export interface ListTasksArgs {
  limit?: number
  offset?: number
}

export interface DeleteTaskArgs {
  id: string
}
