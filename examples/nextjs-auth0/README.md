# Next.js Auth0 Task Board

A minimal Next.js App Router example with **Auth0** login, **shadcn/ui**, **Tailwind CSS v4**, and a per-user task board. SolvaPay is intentionally not included — this is a clean auth + CRUD starter that mirrors the task domain used in [`express-basic`](../express-basic).

## What it demonstrates

- Auth0 v4 login/logout via `proxy.ts` (`/auth/login`, `/auth/callback`, `/auth/logout`)
- Protected dashboard page (server-side session check)
- Protected `/api/tasks` route keyed by `session.user.sub`
- shadcn/ui components (Button, Card, Input) with Tailwind theme tokens
- In-memory task storage (resets when the dev server restarts)

## Prerequisites

- Node.js 20+
- pnpm (from repo root)
- An [Auth0](https://auth0.com) account

## Auth0 setup

1. Create a **Regular Web Application** in the Auth0 Dashboard.
2. Configure URLs for local dev (port **3013**):
   - **Allowed Callback URLs:** `http://localhost:3013/auth/callback`
   - **Allowed Logout URLs:** `http://localhost:3013`
3. Copy Domain, Client ID, and Client Secret from the application settings.

## Run locally

From the repo root:

```bash
pnpm install
cd examples/nextjs-auth0
cp .env.example .env.local
```

Edit `.env.local`:

```env
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
AUTH0_SECRET=your_32_byte_hex_secret   # openssl rand -hex 32
APP_BASE_URL=http://localhost:3013
```

Start the dev server:

```bash
pnpm dev
```

Open [http://localhost:3013](http://localhost:3013).

## Manual test flow

1. Visit `/` — public landing page
2. Click **Log in to dashboard** — Auth0 Universal Login
3. After login, `/dashboard` shows your task board
4. Add and delete tasks — persisted per Auth0 user for the server lifetime
5. Log out — returns via `/auth/logout`
6. Sign in as a different user — separate task list

## API

All endpoints require an authenticated Auth0 session (401 otherwise).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks for the current user |
| `POST` | `/api/tasks` | Create task `{ "title": "..." }` |
| `DELETE` | `/api/tasks?id={taskId}` | Delete a task |

## Project structure

```
app/
  page.tsx              # Public landing
  dashboard/page.tsx    # Protected task dashboard
  api/tasks/route.ts    # Session-gated CRUD
components/
  site-header.tsx       # Login / logout
  task-board.tsx        # Client-side task UI
lib/
  auth0.ts              # Auth0Client instance
  tasks-store.ts        # In-memory Map keyed by user.sub
proxy.ts                # Auth0 middleware (Next.js 16)
```

## Adding SolvaPay later

This example uses Auth0 `session.user.sub` as the customer identity — the same pattern SolvaPay expects from a custom auth adapter. When you're ready, see the [Custom Authentication Adapters guide](../../docs/guides/custom-auth.mdx) (Auth0 server adapter section) and the paywall pattern in [`express-basic`](../express-basic).

A natural follow-up is a free-tier task limit (e.g. 5 tasks) with SolvaPay checkout to unlock unlimited tasks.
