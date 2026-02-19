import { getTask, updateTask, deleteTask } from '@/services/tasksService'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

// Next.js 15 route context type
interface RouteContext {
  params: Promise<{ id: string }>
}

export const GET = async (request: Request, context: RouteContext) => {
  const solvaPay = getSolvaPay()
  
  const product = process.env.NEXT_PUBLIC_PRODUCT_REF
  
  // Extract user ID from middleware-set header
  const rawUserId = request.headers.get('x-user-id')
  
  const basicPayable = solvaPay.payable(product ? { product } : {})

  return basicPayable.next(getTask, {
    extractArgs: async (req: Request, ctx: RouteContext) => {
      // Extract task ID from route params (Next.js 15+ requires awaiting params)
      const params = await ctx.params
      const id = params.id
      
      return {
        id,
        // Pass userId to the service
        userId: rawUserId || undefined,
      }
    }
  })(request, context)
}

export const PUT = async (request: Request, context: RouteContext) => {
  const solvaPay = getSolvaPay()
  
  const product = process.env.NEXT_PUBLIC_PRODUCT_REF
  
  // Extract raw user ID from middleware-set header
  const rawUserId = request.headers.get('x-user-id')
  
  const payable = solvaPay.payable(product ? { product } : {})

  return payable.next(updateTask, {
    extractArgs: async (req: Request, ctx: RouteContext) => {
      // Extract task ID from route params (Next.js 15+ requires awaiting params)
      const params = await ctx.params
      const id = params.id
      
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
        id,
        ...body,
        // Pass userId to the service
        userId: rawUserId || undefined,
      }
    }
  })(request, context)
}

export const DELETE = async (request: Request, context: RouteContext) => {
  const solvaPay = getSolvaPay()
  
  const product = process.env.NEXT_PUBLIC_PRODUCT_REF
  
  // Extract raw user ID from middleware-set header
  const rawUserId = request.headers.get('x-user-id')
  
  // For delete, we ideally want a premium product, but we'll use the configured one if set
  const premiumPayable = solvaPay.payable(product ? { product } : {})

  return premiumPayable.next(deleteTask, {
    extractArgs: async (req: Request, ctx: RouteContext) => {
      // Extract task ID from route params (Next.js 15+ requires awaiting params)
      const params = await ctx.params
      const id = params.id
      
      return {
        id,
        // Pass userId to the service
        userId: rawUserId || undefined,
      }
    }
  })(request, context)
}
