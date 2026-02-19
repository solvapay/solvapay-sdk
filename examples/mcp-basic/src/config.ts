import { createSolvaPay } from '@solvapay/server'
import { createStubClient } from '../../shared/stub-api-client'

/**
 * Initialize paywall system (using shared stub client)
 * Use in-memory storage for tests (file storage gets cleaned up by tests anyway)
 */
const apiClient = createStubClient({
  useFileStorage: false, // In-memory only (tests delete .demo-data)
  freeTierLimit: 3, // 3 free calls per day per plan
  debug: true,
})

/**
 * Initialize SolvaPay with the new unified API
 */
export const solvaPay = createSolvaPay({
  apiClient,
})

/**
 * Create payable handler with explicit MCP adapter
 */
export const payable = solvaPay.payable({ product: 'basic-crud' })

