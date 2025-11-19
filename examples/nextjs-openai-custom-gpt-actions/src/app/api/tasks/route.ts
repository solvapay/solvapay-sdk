import { createTask, listTasks } from '@/services/tasksService'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  const payable = solvaPay.payable({ agent: 'crud-basic' })
  return payable.next(listTasks)(request, context)
}

export const POST = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  const payable = solvaPay.payable({ agent: 'crud-basic' })
  return payable.next(createTask)(request, context)
}
