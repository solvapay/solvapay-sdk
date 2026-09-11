import type { Plugin, Connect } from 'vite'
import { handleSolvaPayRequest } from './middleware'

/**
 * Vite plugin that mounts SolvaPay API routes (`/api/*`) as connect-style
 * middleware in both the dev server and the preview server. This lets the
 * Vite browser app talk to SolvaPay without spinning up a separate Express
 * backend — `SOLVAPAY_SECRET_KEY` stays server-side, the browser only
 * forwards an anonymous `x-customer-ref` header for customer identity.
 */
export function solvapayApiPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url ?? ''
    if (!url.startsWith('/api/')) {
      next()
      return
    }
    handleSolvaPayRequest(req, res).catch(next)
  }

  return {
    name: 'solvapay-api',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
