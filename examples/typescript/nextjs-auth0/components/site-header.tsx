import Link from 'next/link'

import { auth0 } from '@/lib/auth0'
import { Button } from '@/components/ui/button'
import { CreditBadge } from '@/components/credit-badge'

export async function SiteHeader() {
  const session = await auth0.getSession()
  const user = session?.user

  return (
    <header className="border-b">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href={user ? '/dashboard' : '/'} className="text-sm font-semibold tracking-tight">
          Next.js Auth0 Tasks
        </Link>
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {/* SolvaPay credit balance — renders nothing until a balance loads. */}
              <CreditBadge />
              <span className="text-sm text-muted-foreground">
                {typeof user.name === 'string' ? user.name : user.email}
              </span>
              <Button variant="outline" size="sm" asChild>
                <a href="/auth/logout">Log out</a>
              </Button>
            </>
          ) : (
            <Button size="sm" asChild>
              <a href="/auth/login?returnTo=/dashboard">Log in</a>
            </Button>
          )}
        </div>
      </div>
    </header>
  )
}
