import { getTask, updateTask, deleteTask } from '@/services/tasksService'
import { createSolvaPay } from '@solvapay/server'

function getSolvaPay() {
  return createSolvaPay()
}

export const GET = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  
  const agent = process.env.NEXT_PUBLIC_AGENT_REF
  
  // Extract raw user ID from middleware-set header (Supabase UUID without prefix)
  const rawUserId = request.headers.get('x-user-id')
  
  const basicPayable = solvaPay.payable(agent ? { agent } : {})

  return basicPayable.next(getTask, {
    extractArgs: async (req: Request, ctx?: any) => {
      // Extract task ID from route params (Next.js 15+ requires awaiting params)
      const params = await ctx?.params
      const id = params?.id
      
      return {
        id,
        // Pass raw userId to the service (for Supabase queries)
        userId: rawUserId || undefined,
      }
    }
  })(request, context)
}

export const PUT = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  
  const agent = process.env.NEXT_PUBLIC_AGENT_REF
  
  // Extract raw user ID from middleware-set header
  const rawUserId = request.headers.get('x-user-id')
  
  const payable = solvaPay.payable(agent ? { agent } : {})

  return payable.next(updateTask, {
    extractArgs: async (req: Request, ctx?: any) => {
      // Extract task ID from route params (Next.js 15+ requires awaiting params)
      const params = await ctx?.params
      const id = params?.id
      
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
        // Pass raw userId to the service (for Supabase queries)
        userId: rawUserId || undefined,
      }
    }
  })(request, context)
}

export const DELETE = async (request: Request, context?: any) => {
  const solvaPay = getSolvaPay()
  
  const agent = process.env.NEXT_PUBLIC_AGENT_REF
  
  // Extract raw user ID from middleware-set header
  const rawUserId = request.headers.get('x-user-id')
  
  // For delete, we ideally want a premium agent, but we'll use the configured one if set
  const premiumPayable = solvaPay.payable(agent ? { agent } : {})

  return premiumPayable.next(deleteTask, {
    extractArgs: async (req: Request, ctx?: any) => {
      // Extract task ID from route params (Next.js 15+ requires awaiting params)
      const params = await ctx?.params
      const id = params?.id
      
      return {
        id,
        // Pass raw userId to the service (for Supabase queries)
        userId: rawUserId || undefined,
      }
    }
  })(request, context)
}
