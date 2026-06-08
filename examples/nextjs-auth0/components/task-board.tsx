'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { Task } from '@/lib/tasks-store'

export function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadTasks = useCallback(async () => {
    setError(null)
    const response = await fetch('/api/tasks')

    if (!response.ok) {
      throw new Error('Failed to load tasks')
    }

    const data: { tasks: Task[] } = await response.json()
    setTasks(data.tasks)
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      try {
        await loadTasks()
      } catch {
        if (!cancelled) {
          setError('Could not load tasks. Try refreshing the page.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [loadTasks])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle }),
      })

      if (!response.ok) {
        throw new Error('Failed to create task')
      }

      setTitle('')
      await loadTasks()
    } catch {
      setError('Could not create task. Try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async (taskId: string) => {
    setError(null)

    try {
      const response = await fetch(`/api/tasks?id=${encodeURIComponent(taskId)}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete task')
      }

      await loadTasks()
    } catch {
      setError('Could not delete task. Try again.')
    }
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading tasks...</p>
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={title}
          onChange={event => setTitle(event.target.value)}
          placeholder="Add a task..."
          aria-label="Task title"
          disabled={isSubmitting}
        />
        <Button type="submit" disabled={isSubmitting || title.trim().length === 0}>
          Add
        </Button>
      </form>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No tasks yet. Add your first one above.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {tasks.map(task => (
            <li key={task.id}>
              <Card>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <div>
                    <p className="font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(task.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${task.title}`}
                    onClick={() => void handleDelete(task.id)}
                  >
                    <Trash2 />
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
