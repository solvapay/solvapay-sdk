import { getTask, deleteTask } from '@/services/tasksService'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  
  const agent = process.env.NEXT_PUBLIC_AGENT_REF
  const basicPayable = solvaPay.payable(agent ? { agent } : {})

  return basicPayable.next(getTask)(request, context)
}

export const DELETE = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  
  const agent = process.env.NEXT_PUBLIC_AGENT_REF
  // For delete, we ideally want a premium agent, but we'll use the configured one if set
  const premiumPayable = solvaPay.payable(agent ? { agent } : {})

  return premiumPayable.next(deleteTask)(request, context)
}
