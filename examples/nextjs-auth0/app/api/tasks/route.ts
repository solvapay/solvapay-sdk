import { NextRequest, NextResponse } from 'next/server'

import { auth0 } from '@/lib/auth0'
import { solvaPay, PRODUCT_REF } from '@/lib/solvapay'
import { createTask, deleteTask, listTasks } from '@/lib/tasks-store'

async function getAuthenticatedUserId(): Promise<string | null> {
  const session = await auth0.getSession()
  return session?.user?.sub ?? null
}

export async function GET() {
  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({ tasks: listTasks(userId) })
}

/**
 * Creating a task is the metered, paid action. `payable.next` checks the
 * customer's Pay As You Go access before the handler runs — returning a 402
 * with checkout details when they have no credits — and records one usage
 * event ("request") against the plan when it succeeds. The customer ref is
 * the Auth0 `sub` forwarded as `x-user-id` by `proxy.ts`.
 */
const payable = solvaPay.payable({ product: PRODUCT_REF })

export async function POST(request: NextRequest, context: unknown) {
  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Build the protected handler per request, closing over the user id we just
  // resolved. (Reading the Auth0 session again inside the SolvaPay callback is
  // unreliable — the request context isn't guaranteed there.) `payable.next`
  // checks Pay As You Go access first (402 when out of credits) and records
  // one usage event ("request") on success.
  const protectedCreate = payable.next(async (args: Record<string, unknown>) => {
    const title = args.title
    if (typeof title !== 'string') {
      throw new Error('Title must be a string')
    }
    const task = createTask(userId, title)
    return { task }
  })

  return protectedCreate(request, context)
}

export async function DELETE(request: NextRequest) {
  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const taskId = new URL(request.url).searchParams.get('id')
  if (!taskId) {
    return NextResponse.json({ error: 'Missing task id' }, { status: 400 })
  }

  const deleted = deleteTask(userId, taskId)
  if (!deleted) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
