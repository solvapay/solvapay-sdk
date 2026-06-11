import { createAuth0AuthAdapter } from '@solvapay/auth/auth0'
import { createAuthMiddleware } from '@solvapay/next/middleware'
import { auth0 } from './lib/auth0'

export const proxy = createAuthMiddleware({
  adapter: createAuth0AuthAdapter({ auth0 }),
  processAllRoutes: true,
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
