import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Next.js Auth0 task board</h1>
      <p className="mt-3 text-muted-foreground">
        A minimal example with Auth0 login, shadcn/ui, and Tailwind CSS. Sign in to manage
        your own task list — each Auth0 user gets a separate in-memory board.
      </p>

      <Card className="mt-10">
        <CardHeader>
          <CardTitle>Get started</CardTitle>
          <CardDescription>
            Configure Auth0 credentials in <code>.env.local</code>, then log in to open your
            dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <a href="/auth/login?returnTo=/dashboard">Log in to dashboard</a>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
