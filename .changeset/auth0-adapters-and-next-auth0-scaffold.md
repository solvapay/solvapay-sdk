---
"@solvapay/auth": minor
"@solvapay/next": minor
"@solvapay/react": minor
"@solvapay/react-supabase": patch
"@solvapay/server": patch
"create-solvapay": minor
---

Add Auth0 identity adapters across `@solvapay/auth`, `@solvapay/react`, and `@solvapay/next` (`createAuth0AuthMiddleware`), plus a `next-auth0` scaffolder template. The Next.js middleware now strips client-supplied identity headers (`x-user-id`, `authorization`) before forwarding a verified session identity downstream.
