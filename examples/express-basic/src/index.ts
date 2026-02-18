import 'dotenv/config'
import express, { type Express } from 'express'
import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from '../../shared/stub-api-client'
import { createTask, getTask, listTasks, deleteTask, getTaskCount } from '@solvapay/demo-services'

const app: Express = express()
const port = parseInt(process.env.PORT || '3001', 10)

// Initialize SolvaPay with stub client for demo purposes
// This example demonstrates the integration patterns - not real API calls
const apiClient = createStubClient({
  freeTierLimit: 5, // 5 free calls per day for demo
  debug: process.env.STUB_DEBUG !== 'false', // Disable debug in tests
})

// Initialize SolvaPay with the new unified API
const solvaPay = createSolvaPay({
  apiClient,
})

// Create payable handler with explicit HTTP adapter
const payable = solvaPay.payable({ product: 'prd_NO8WYSX5', plan: 'pln_MUKDWQZZ' })

app.use(express.json())

// ============================================================================
// Routes - Unprotected
// ============================================================================

app.get('/', (req, res) => {
  res.json({
    name: 'SolvaPay Express Example - Task API',
    description: 'Demo showing how to integrate SolvaPay with Express',
    version: '1.0.0',
    mode: 'demo',
    endpoints: {
      protected: [
        'POST /tasks - Create a task',
        'GET /tasks/:id - Get a task by ID',
        'GET /tasks - List all tasks',
        'DELETE /tasks/:id - Delete a task',
      ],
      unprotected: ['GET / - This endpoint', 'GET /health - Health check'],
    },
    paywall: {
      enabled: true,
      freeTier: '5 calls per day per plan',
      note: 'Using stub client for demonstration',
    },
    usage: {
      customerRef: 'Pass x-customer-ref header to identify yourself',
      example: 'curl -H "x-customer-ref: user_123" http://localhost:3001/tasks',
    },
  })
})

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Express server is running',
    timestamp: new Date().toISOString(),
    tasksCount: getTaskCount(),
  })
})

// ============================================================================
// Routes - Protected with SolvaPay
// ============================================================================

// Create a new task (protected)
app.post('/tasks', payable.http(createTask))

// Get a task by ID (protected)
app.get('/tasks/:id', payable.http(getTask))

// List all tasks (protected)
app.get('/tasks', payable.http(listTasks))

// Delete a task (protected)
app.delete('/tasks/:id', payable.http(deleteTask))

// ============================================================================
// Start Server
// ============================================================================

function startServer(port: number) {
  const server = app
    .listen(port)
    .on('listening', () => {
      console.log('\n🚀 SolvaPay Express Example - Task API')
      console.log('='.repeat(60))
      console.log(`\n📍 Server running on http://localhost:${port}`)
      console.log(`\nMode: Demo (stub client)`)
      console.log(`Free tier: 5 calls per day per plan`)

      console.log('\n📋 Try these commands:\n')

      console.log('# Get API info (unprotected)')
      console.log(`curl http://localhost:${port}/\n`)

      console.log('# Create a task (protected)')
      console.log(`curl -X POST http://localhost:${port}/tasks \\`)
      console.log(`  -H "Content-Type: application/json" \\`)
      console.log(`  -H "x-customer-ref: demo_user" \\`)
      console.log(`  -d '{"title": "My first task"}'\n`)

      console.log('# List tasks (protected)')
      console.log(`curl http://localhost:${port}/tasks \\`)
      console.log(`  -H "x-customer-ref: demo_user"\n`)

      console.log('💡 Tip: Make 6+ requests with same customer_ref to see paywall')

      console.log('\n' + '='.repeat(60) + '\n')
    })
    .on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  Port ${port} is in use, trying ${port + 1}...`)
        startServer(port + 1)
      } else {
        console.error('❌ Failed to start server:', err)
        process.exit(1)
      }
    })
}

// Only start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer(port)
}

// Export for testing
export { app, solvaPay, apiClient }
