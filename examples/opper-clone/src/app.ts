import { Hono } from 'hono'
import { compatRoutes, type CompatDeps } from './routes/compat'

export function createApp(deps: CompatDeps): Hono {
  const app = new Hono()
  app.get('/health', c => c.json({ ok: true }))
  app.route('/', compatRoutes(deps))
  return app
}
