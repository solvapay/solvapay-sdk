import 'dotenv/config'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from '../../shared/stub-api-client'
import { createTask, getTask, listTasks, deleteTask, getTaskCount } from '@solvapay/demo-services'

const app: Express = express()
const port = parseInt(process.env.PORT || '3002', 10)

const apiClient = createStubClient({
  freeTierLimit: 5,
  debug: process.env.STUB_DEBUG !== 'false',
})

const solvaPay = createSolvaPay({
  apiClient,
  limitsCacheTTL: 0,
})

const payable = solvaPay.payable({ product: 'prd_NO8WYSX5' })

app.use(express.json())

/**
 * Provider-owned auth shim.
 *
 * In production this middleware validates *your* session (from your CLI or web IdP)
 * and derives a stable externalRef (e.g. Auth0 sub, Cognito sub, internal user id).
 * This demo accepts x-provider-user-id as if the user already completed `your-cli login`.
 */
const linkSolvaPayCustomer = async (req: Request, res: Response, next: NextFunction) => {
  const externalRef = req.header('x-provider-user-id')?.trim()
  if (!externalRef) {
    res.status(401).json({
      success: false,
      error: 'Provider authentication required',
      hint: 'Send x-provider-user-id after your own CLI/IdP login',
    })
    return
  }

  try {
    const customerRef = await solvaPay.ensureCustomer(externalRef, externalRef, {
      email: req.header('x-provider-user-email') ?? undefined,
      name: req.header('x-provider-user-name') ?? undefined,
    })

    req.headers['x-customer-ref'] = customerRef
    next()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to link customer'
    res.status(500).json({ success: false, error: message })
  }
}

app.get('/', (_req, res) => {
  res.json({
    name: 'SolvaPay Express Provider Linkage Example',
    description:
      'Provider-owned client + IdP: your backend holds sk_* and maps users via ensureCustomer(externalRef)',
    mode: 'demo',
    auth: {
      simulateProviderLogin: 'x-provider-user-id (required)',
      optionalProfile: ['x-provider-user-email', 'x-provider-user-name'],
    },
    example: ['curl -H "x-provider-user-id: auth0|demo-user" http://localhost:3002/tasks'],
  })
})

app.get('/health', (_req, res) => {
  res.json({
    success: true,
    tasksCount: getTaskCount(),
    timestamp: new Date().toISOString(),
  })
})

app.use('/tasks', linkSolvaPayCustomer)

app.post('/tasks', payable.http(createTask))
app.get('/tasks/:id', payable.http(getTask))
app.get('/tasks', payable.http(listTasks))
app.delete('/tasks/:id', payable.http(deleteTask))

function startServer(listenPort: number) {
  app
    .listen(listenPort)
    .on('listening', () => {
      console.log('\n🔗 SolvaPay Express Provider Linkage Example')
      console.log('='.repeat(60))
      console.log(`\n📍 http://localhost:${listenPort}`)
      console.log('\nSimulate a provider CLI user (already logged in to your IdP):\n')
      console.log(`curl -X POST http://localhost:${listenPort}/tasks \\`)
      console.log(`  -H "Content-Type: application/json" \\`)
      console.log(`  -H "x-provider-user-id: auth0|demo-user" \\`)
      console.log(`  -H "x-provider-user-email: demo@example.com" \\`)
      console.log(`  -d '{"title":"Linked task"}'\n`)
    })
    .on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        startServer(listenPort + 1)
      } else {
        console.error(err)
        process.exit(1)
      }
    })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(port)
}

export { app, solvaPay, apiClient }
