// What SolvaPay's classifier gets from a call's prompt (agent payments PoC,
// slice SC; build plan §7k, decision 9). A Claude Code request carries the
// whole conversation, so a hash of the body never repeats. The last user turn
// does: the prompt on the first request, then the tool results. A retried
// failing tool call sends the same result each time, apart from its
// `tool_use_id`, which is left out.
import { promptFacts, type PromptFacts } from '@solvapay/agent-layer'
import { isRecord } from '../lib/guards'

export { PROMPT_EXCERPT_MAX } from '@solvapay/agent-layer'

/** The last user turn of an Anthropic Messages body, or `null` when it has none. */
export function lastUserTurn(body: Record<string, unknown>): PromptFacts | null {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const turn = [...messages].reverse().find(m => isRecord(m) && m.role === 'user')
  if (!isRecord(turn)) return null

  let toolError = false
  const parts: string[] = []
  if (typeof turn.content === 'string') {
    parts.push(turn.content)
  } else if (Array.isArray(turn.content)) {
    for (const block of turn.content) {
      if (!isRecord(block)) continue
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      } else if (block.type === 'tool_result') {
        if (block.is_error === true) toolError = true
        parts.push(
          `[tool result${block.is_error === true ? ', error' : ''}]\n${blockText(block.content)}`,
        )
      } else {
        parts.push(`[${typeof block.type === 'string' ? block.type : 'block'}]`)
      }
    }
  }
  return promptFacts(parts.join('\n\n'), toolError)
}

/** A tool result's content as text: a string, or its text blocks, other blocks named. */
function blockText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(part =>
      isRecord(part) && part.type === 'text' && typeof part.text === 'string'
        ? part.text
        : `[${isRecord(part) && typeof part.type === 'string' ? part.type : 'block'}]`,
    )
    .join('\n')
}
