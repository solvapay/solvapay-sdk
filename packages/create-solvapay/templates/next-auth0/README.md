# **PROJECT_NAME**

Next.js starter scaffolded by `create-solvapay --auth auth0`.

## Includes

- Auth0 server client in `lib/auth0.ts`
- SolvaPay Auth0 middleware wiring in `proxy.ts`
- Minimal App Router shell in `app/`

## Setup

1. Create an Auth0 app and configure callback/logout URLs.
2. Add required Auth0 env vars in `.env.local` (Auth0 docs).
3. Run `npm run dev`.

## SolvaPay

Run `solvapay init` to connect your project with product + API credentials.
