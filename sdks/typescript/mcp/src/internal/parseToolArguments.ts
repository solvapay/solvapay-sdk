import type { CallToolResult } from '@modelcontextprotocol/server'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

type StandardValidation = { value?: unknown; issues?: ReadonlyArray<{ message?: string }> }

/**
 * Parses a locally registered tool's arguments with its input schema, as the
 * MCP SDK's own `tools/call` handler does. Defaults and coercions declared on
 * the schema reach the handler; invalid arguments become a tool error.
 */
export async function parseToolArguments(
  name: string,
  inputSchema: unknown,
  args: unknown,
): Promise<{ ok: true; args: unknown } | { ok: false; result: CallToolResult }> {
  const standard = isRecord(inputSchema) ? inputSchema['~standard'] : undefined
  const validate = isRecord(standard) ? standard.validate : undefined
  if (typeof validate !== 'function') return { ok: true, args }
  const outcome = (await validate(args)) as StandardValidation
  if (outcome.issues === undefined) return { ok: true, args: outcome.value }
  const detail = outcome.issues.map(issue => issue.message ?? 'invalid').join('; ')
  return {
    ok: false,
    result: {
      content: [
        {
          type: 'text',
          text: `Input validation error: Invalid arguments for tool ${name}: ${detail}`,
        },
      ],
      isError: true,
    },
  }
}
