/**
 * Strict Zod schemas for MCP-authoring fixture scenarios and observations.
 * No defaults — a malformed fixture fails parse.
 */

import { z } from 'zod'
import { type Fixture } from '../lib/fixture-schema.js'

const ContentBlock = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .strict()
  .or(
    z
      .object({
        type: z.literal('image'),
        data: z.string(),
        mimeType: z.string(),
      })
      .strict(),
  )
  .or(
    z
      .object({
        type: z.literal('resource'),
        resource: z.record(z.string(), z.unknown()),
      })
      .strict(),
  )

const NudgeSpec = z
  .object({
    kind: z.enum(['low-balance', 'cycle-ending', 'approaching-limit']),
    message: z.string(),
  })
  .strict()

const ResponseOptions = z
  .object({
    text: z.string().optional(),
    nudge: NudgeSpec.optional(),
    units: z.number().optional(),
  })
  .strict()

const HandlerRespond = z
  .object({
    kind: z.literal('respond'),
    data: z.unknown(),
    options: ResponseOptions.optional(),
    emit: z.array(ContentBlock).optional(),
  })
  .strict()

const HandlerGate = z
  .object({
    kind: z.literal('gate'),
    reason: z.string().optional(),
  })
  .strict()

const HandlerThrow = z
  .object({
    kind: z.literal('throw'),
    message: z.string(),
  })
  .strict()

export const HandlerSchema = z.discriminatedUnion('kind', [
  HandlerRespond,
  HandlerGate,
  HandlerThrow,
])

export const LimitsSchema = z
  .object({
    withinLimits: z.boolean(),
    remaining: z.number().optional(),
    plan: z.string().optional(),
    creditBalance: z.number().optional(),
    checkoutUrl: z.string().optional(),
    activationRequired: z.boolean().optional(),
    confirmationUrl: z.string().optional(),
    plans: z.array(z.record(z.string(), z.unknown())).optional(),
    balance: z.unknown().optional(),
    product: z.unknown().optional(),
    meterName: z.string().optional(),
    throttled: z.boolean().optional(),
    overage: z.boolean().optional(),
  })
  .strict()

export const ToolScenarioSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    inputSchema: z.record(z.string(), z.unknown()).optional(),
    args: z.record(z.string(), z.unknown()),
  })
  .strict()

export const ScenarioSchema = z
  .object({
    tool: ToolScenarioSchema,
    product: z.string().min(1),
    customerRef: z.string().min(1),
    customerRefSource: z.enum(['hook', 'toolArgs']),
    usageType: z.string().min(1).optional(),
    limits: LimitsSchema,
    handler: HandlerSchema,
  })
  .strict()

const UsageProjection = z
  .object({
    outcome: z.enum(['success', 'paywall', 'fail']),
    actionType: z.string(),
    units: z.number(),
    productRef: z.string(),
    customerRef: z.string(),
    metadata: z.object({ action: z.string() }).strict(),
  })
  .strict()

export const ToolResultSchema = z
  .object({
    content: z.array(z.record(z.string(), z.unknown())),
    structuredContent: z.unknown().optional(),
    isError: z.boolean().optional(),
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()

export const ObservationSchema = z
  .object({
    toolResult: ToolResultSchema,
    usage: z.array(UsageProjection),
  })
  .strict()

export type McpAuthoringScenario = z.infer<typeof ScenarioSchema>
export type McpAuthoringObservation = z.infer<typeof ObservationSchema>
export type UsageProjection = z.infer<typeof UsageProjection>

export function parseScenario(args: Record<string, unknown>): McpAuthoringScenario {
  return ScenarioSchema.parse(args)
}

export function parseObservation(result: unknown): McpAuthoringObservation {
  return ObservationSchema.parse(result)
}

export function parseMcpAuthoringFixture(fixture: Fixture): {
  scenario: McpAuthoringScenario
  observation: McpAuthoringObservation
} {
  if (fixture.input.fn !== 'registerPayable') {
    throw new Error(`expected input.fn registerPayable, got ${fixture.input.fn}`)
  }
  if (!Object.prototype.hasOwnProperty.call(fixture.expect, 'result')) {
    throw new Error('MCP-authoring fixtures must use expect.result')
  }
  return {
    scenario: parseScenario(fixture.input.args),
    observation: parseObservation(fixture.expect.result),
  }
}
