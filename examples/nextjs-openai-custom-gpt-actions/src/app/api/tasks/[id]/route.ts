import { getTask, deleteTask } from '@solvapay/demo-services'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  const basicPayable = solvaPay.payable({ agent: 'crud-basic' })
  return basicPayable.next(getTask)(request, context)
}

export const DELETE = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  const premiumPayable = solvaPay.payable({ agent: 'crud-premium' })
  return premiumPayable.next(deleteTask)(request, context)
}
