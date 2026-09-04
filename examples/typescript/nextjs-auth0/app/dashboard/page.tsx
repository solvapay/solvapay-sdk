import { redirect } from 'next/navigation'

import { TaskBoard } from '@/components/task-board'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { auth0 } from '@/lib/auth0'

export default async function DashboardPage() {
  const session = await auth0.getSession()

  if (!session) {
    redirect('/auth/login?returnTo=/dashboard')
  }

  const displayName =
    typeof session.user.name === 'string'
      ? session.user.name
      : typeof session.user.email === 'string'
        ? session.user.email
        : 'there'

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Your tasks</CardTitle>
          <CardDescription>
            Signed in as {displayName}. Tasks are stored in memory and reset when the dev server
            restarts.
          </CardDescription>
        </CardHeader>
      </Card>

      <TaskBoard />
    </main>
  )
}
