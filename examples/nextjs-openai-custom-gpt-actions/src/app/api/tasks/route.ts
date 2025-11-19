import { createTask, listTasks } from '@/services/tasksService'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  const payable = solvaPay.payable({ agent: 'crud-basic' })
  
  // Extract user ID from custom header (set by middleware for OAuth)
  const userId = request.headers.get('x-user-id') || undefined

  return payable.next((args) => listTasks({ ...args, userId }))(request, context)
}

export const POST = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  const payable = solvaPay.payable({ agent: 'crud-basic' })
  
  // Extract user ID from custom header (set by middleware for OAuth)
  const userId = request.headers.get('x-user-id') || undefined

  return payable.next((args) => createTask({ ...args, userId }))(request, context)
}
