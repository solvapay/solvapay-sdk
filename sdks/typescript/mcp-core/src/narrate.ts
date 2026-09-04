/**
 * Intent-tool narrators — thin wrappers over the Rust `mcpNarrate` op.
 * Markdown is user-visible in agent transcripts; do not reimplement it here.
 */

import { callMcpSyncOp } from './native-mcp'
import type { BootstrapPayload } from './types'

export interface NarratorOutput {
  text: string
  links?: Array<{ uri: string; name: string }>
}

export type IntentTool = 'upgrade' | 'manage_account' | 'topup' | 'activate_plan'

type NarrateEnvelope = {
  text?: unknown
  links?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asNarratorOutput(value: unknown): NarratorOutput {
  if (!isRecord(value)) {
    throw new Error('mcpNarrate returned a non-object narrator envelope')
  }
  const text = typeof value.text === 'string' ? value.text : ''
  const links = Array.isArray(value.links)
    ? value.links.flatMap(link => {
        if (!isRecord(link)) return []
        const uri = typeof link.uri === 'string' ? link.uri : ''
        const name = typeof link.name === 'string' ? link.name : ''
        return uri && name ? [{ uri, name }] : []
      })
    : undefined
  return links && links.length > 0 ? { text, links } : { text }
}

function narrate(tool: IntentTool, data: BootstrapPayload): NarratorOutput {
  return asNarratorOutput(callMcpSyncOp<NarrateEnvelope>('mcpNarrate', { tool, payload: data }))
}

export function narrateManageAccount(data: BootstrapPayload): NarratorOutput {
  return narrate('manage_account', data)
}

export function narrateUpgrade(data: BootstrapPayload): NarratorOutput {
  return narrate('upgrade', data)
}

export function narrateTopup(data: BootstrapPayload): NarratorOutput {
  return narrate('topup', data)
}

export function narrateActivatePlan(data: BootstrapPayload): NarratorOutput {
  return narrate('activate_plan', data)
}

export const NARRATORS: Record<IntentTool, (data: BootstrapPayload) => NarratorOutput> = {
  upgrade: narrateUpgrade,
  manage_account: narrateManageAccount,
  topup: narrateTopup,
  activate_plan: narrateActivatePlan,
}

export function uiPlaceholder(tool: IntentTool, data: BootstrapPayload): string {
  const result = callMcpSyncOp<NarrateEnvelope>('mcpNarrate', {
    tool,
    payload: data,
    kind: 'placeholder',
  })
  return typeof result.text === 'string' ? result.text : ''
}

export function balanceSummary(customer: { balance?: unknown } | null | undefined): string | null {
  const result = callMcpSyncOp<NarrateEnvelope>('mcpNarrate', {
    tool: 'manage_account',
    payload: customer ?? {},
    kind: 'balanceSummary',
  })
  return typeof result.text === 'string' ? result.text : null
}
