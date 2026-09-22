'use client'

import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useBalance } from '@solvapay/react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { CheckoutPanel } from '@/components/checkout-panel'
import type { Task } from '@/lib/tasks-store'

export function TaskBoard() {
  // Pay As You Go access is governed by the credit balance, NOT by
  // `hasPaidPurchase`: a usage-based plan activates at zero amount and top-ups
  // are recorded as credit transactions (not "paid plan" purchases), so
  // `hasPaidPurchase` stays false even with a full wallet.
  const { credits, loading: balanceLoading, refetch: refetchBalance } = useBalance()
  const hasCredits = typeof credits === 'number' && credits > 0

  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set when /api/tasks returns 402 — the customer ran out of Pay As You Go
  // credits and needs to (re)open the embedded checkout to top up.
  const [needsCheckout, setNeedsCheckout] = useState(false)

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

  const handlePurchased = useCallback(async () => {
    setNeedsCheckout(false)
    await refetchBalance()
  }, [refetchBalance])

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

      if (response.status === 402) {
        // Out of credits — surface the embedded checkout to top up.
        setNeedsCheckout(true)
        await refetchBalance()
        return
      }

      if (!response.ok) {
        throw new Error('Failed to create task')
      }

      setTitle('')
      await loadTasks()
      await refetchBalance()
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

  if (isLoading || balanceLoading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>
  }

  // Gate task creation on the credit balance. Show the embedded checkout until
  // the customer has credits (or once a 402 says they've run out); the board
  // returns the moment a top-up lands and the balance reflects it.
  if (!hasCredits || needsCheckout) {
    return (
      <Card>
        <CardContent className="space-y-4 p-6">
          <section aria-label="Checkout required">
            <h2 className="text-base font-semibold">Unlock the task board</h2>
            <p className="text-sm text-muted-foreground">
              {needsCheckout
                ? 'You are out of credits. Top up to keep adding tasks — each task costs one request.'
                : 'Adding tasks is billed pay-as-you-go. Buy credits below to get started — each task costs one request.'}
            </p>
          </section>
          <CheckoutPanel onPurchased={() => void handlePurchased()} />
        </CardContent>
      </Card>
    )
  }

  return (
    <section className="space-y-6" aria-label="Task board">
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

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

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
                  <article>
                    <p className="font-medium">{task.title}</p>
                    <time className="text-xs text-muted-foreground" dateTime={task.createdAt}>
                      {new Date(task.createdAt).toLocaleString()}
                    </time>
                  </article>
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
    </section>
  )
}
