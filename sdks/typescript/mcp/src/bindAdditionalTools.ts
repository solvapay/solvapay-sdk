/**
 * Shared `additionalTools` binder used by `createSolvaPayMcpServer` and
 * the fetch factory so `registerPayable` / `registerFree` stay in lockstep.
 */

import type { McpServer } from '@modelcontextprotocol/server'
import type { SolvaPay } from '@solvapay/server'
import { freeLimitsAgree, normalizeFreeLimit, type FreeLimit } from '@solvapay/server'
import { registerFreeTool, type RegisterFreeToolOptions } from './registerFreeTool'
import {
  registerPayableTool,
  type InputSchemaOption,
  type RegisterPayableToolOptions,
} from './registerPayableTool'
import type { AdditionalToolsContext } from './server'

export function bindAdditionalTools(
  server: McpServer,
  solvaPay: SolvaPay,
  productRef: string,
  resourceUri: string,
  additionalTools: ((ctx: AdditionalToolsContext) => void) | undefined,
): void {
  if (!additionalTools) return
  const freeMeterOwners = new Map<string, { limit: FreeLimit; tools: string[] }>()

  const registerPayable: AdditionalToolsContext['registerPayable'] = (name, opts) => {
    registerPayableTool(server, name, {
      solvaPay,
      ...opts,
      product: opts.product ?? productRef,
    })
  }

  const registerFree: AdditionalToolsContext['registerFree'] = (name, opts) => {
    const product = opts.product ?? productRef
    const normalized = normalizeFreeLimit({
      cap: opts.limit.cap,
      scope: opts.limit.scope,
      ...(opts.limit.meter !== undefined ? { meter: opts.limit.meter } : {}),
      ...(opts.limit.windowDays !== undefined ? { windowDays: opts.limit.windowDays } : {}),
    })
    if ('error' in normalized) {
      throw new Error(normalized.error)
    }
    const existing = freeMeterOwners.get(normalized.meter)
    if (existing && !freeLimitsAgree(existing.limit, normalized)) {
      throw new Error(
        `Free allowance meter '${normalized.meter}' is already used by ${existing.tools.join(', ')} with a different cap than ${name}`,
      )
    }
    const tools = existing ? [...existing.tools, name] : [name]
    freeMeterOwners.set(normalized.meter, { limit: normalized, tools })
    const sharedWith = tools.filter(tool => tool !== name)
    registerFreeTool(server, name, {
      solvaPay,
      ...opts,
      product,
      sharedWith,
    } as RegisterFreeToolOptions)
  }

  additionalTools({ server, solvaPay, resourceUri, productRef, registerPayable, registerFree })
}

export type BoundPayableOptions<
  InputSchema extends InputSchemaOption = undefined,
  TData = unknown,
> = Omit<RegisterPayableToolOptions<InputSchema, TData>, 'solvaPay' | 'product'> & {
  product?: string
}
