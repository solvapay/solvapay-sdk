import { createTask, listTasks } from '@/services/tasksService'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export const GET = async (request: Request) => {
  const solvaPay = getSolvaPay()
  
  // Use configured product ref if available
  const product = process.env.NEXT_PUBLIC_PRODUCT_REF
  
  // Extract user ID from middleware-set header
  const rawUserId = request.headers.get('x-user-id')
  
  const payable = solvaPay.payable(product ? { product } : {})

  return payable.next(listTasks, {
    extractArgs: async (req: Request) => {
      const url = new URL(req.url)
      const query = Object.fromEntries(url.searchParams.entries())
      
      return {
        ...query,
        // Pass userId to the service
        userId: rawUserId || undefined,
      }
    }
  })(request)
}

export const POST = async (request: Request) => {
  const solvaPay = getSolvaPay()
  
  const product = process.env.NEXT_PUBLIC_PRODUCT_REF
  
  // Extract raw user ID from middleware-set header
  const rawUserId = request.headers.get('x-user-id')
  
  const payable = solvaPay.payable(product ? { product } : {})

  return payable.next(createTask, {
    extractArgs: async (req: Request) => {
      const url = new URL(req.url)
      const query = Object.fromEntries(url.searchParams.entries())
      
      // Parse body
      let body = {}
      try {
        if (req.method !== 'GET' && req.headers.get('content-type')?.includes('application/json')) {
          body = await req.json()
        }
      } catch {
        // Continue with empty body
      }
      
      return {
        ...body,
        ...query,
        // Pass userId to the service
        userId: rawUserId || undefined,
      }
    }
  })(request)
}
