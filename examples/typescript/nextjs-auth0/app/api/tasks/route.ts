import { NextRequest, NextResponse } from 'next/server'

import { auth0 } from '@/lib/auth0'
import { getProductRef, getSolvaPay } from '@/lib/solvapay'
import { createTask, deleteTask, listTasks } from '@/lib/tasks-store'

/**
 * Resolve the current user from the Auth0 httpOnly session.
 * Returns Auth0 `sub` — the same value `proxy.ts` forwards as `x-user-id`.
 */
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
 * Creating a task is the metered, paid action. Identity chain for billing:
 *
 *   Auth0 session (httpOnly cookie)
 *     → `session.user.sub`
 *     → `proxy.ts` sets `x-user-id` on the request
 *     → `@solvapay/next` / `payable.next` resolves SolvaPay customer by `externalRef`
 *
 * `payable.next` checks Pay As You Go access before the handler runs (402 when out
 * of credits) and records one usage event ("request") on success.
 */
export async function POST(request: NextRequest, context: unknown) {
  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payable = getSolvaPay().payable({ product: getProductRef() })

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
