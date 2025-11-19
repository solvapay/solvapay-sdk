import { createTask, listTasks } from '@/services/tasksService'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  
  // Use configured agent ref if available
  const agent = process.env.NEXT_PUBLIC_AGENT_REF
  
  // We don't need to manually pass userId here.
  // The middleware sets 'x-user-id', and solvaPay.payable() automatically 
  // extracts it and populates args.auth.customer_ref
  const payable = solvaPay.payable(agent ? { agent } : {})

  return payable.next(listTasks)(request, context)
}

export const POST = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  
  const agent = process.env.NEXT_PUBLIC_AGENT_REF
  
  const payable = solvaPay.payable(agent ? { agent } : {})

  return payable.next(createTask)(request, context)
}
