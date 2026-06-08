import { NextResponse } from 'next/server'

import { auth0 } from '@/lib/auth0'
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

export async function POST(request: Request) {
  const userId = await getAuthenticatedUserId()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null || !('title' in body)) {
    return NextResponse.json({ error: 'Missing title' }, { status: 400 })
  }

  const title = body.title
  if (typeof title !== 'string') {
    return NextResponse.json({ error: 'Title must be a string' }, { status: 400 })
  }

  try {
    const task = createTask(userId, title)
    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create task'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
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
