import { getTask, deleteTask } from '@/services/tasksService'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  const basicPayable = solvaPay.payable({ agent: 'crud-basic' })
  
  // Extract user ID from custom header (set by middleware for OAuth)
  const userId = request.headers.get('x-user-id') || undefined

  return basicPayable.next((args) => getTask({ ...args, userId }))(request, context)
}

export const DELETE = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  const premiumPayable = solvaPay.payable({ agent: 'crud-premium' })
  
  // Extract user ID from custom header (set by middleware for OAuth)
  const userId = request.headers.get('x-user-id') || undefined

  return premiumPayable.next((args) => deleteTask({ ...args, userId }))(request, context)
}
