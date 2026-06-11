import { createAuth0AuthMiddleware } from '@solvapay/next/middleware'

import { auth0 } from './lib/auth0'

export const proxy = createAuth0AuthMiddleware({ auth0 })

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
}
