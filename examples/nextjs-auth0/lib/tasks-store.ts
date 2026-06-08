export type Task = {
  id: string
  title: string
  createdAt: string
}

const tasksByUser = new Map<string, Task[]>()

export function listTasks(userId: string): Task[] {
  return tasksByUser.get(userId) ?? []
}

export function createTask(userId: string, title: string): Task {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) {
    throw new Error('Task title is required')
  }

  const task: Task = {
    id: crypto.randomUUID(),
    title: trimmedTitle,
    createdAt: new Date().toISOString(),
  }

  const existing = tasksByUser.get(userId) ?? []
  tasksByUser.set(userId, [task, ...existing])
  return task
}

export function deleteTask(userId: string, taskId: string): boolean {
  const existing = tasksByUser.get(userId) ?? []
  const next = existing.filter(task => task.id !== taskId)

  if (next.length === existing.length) {
    return false
  }

  tasksByUser.set(userId, next)
  return true
}
