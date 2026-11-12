// What SolvaPay's classifier gets from a call's prompt (agent payments PoC,
// slice SC; build plan §7k, decision 9): a hash of the text, whether it
// carries a failed tool result, and its end, which goes only once the owner
// opted in. Each merchant picks the text from its own protocol (an LLM
// proxy: the last user turn; an MCP tool: its input), so repeats of the same
// text show loops. The facts come from the Rust core (`agentPromptFacts`).
import { agentPromptFacts, unwrap } from './core'

/** The most of a prompt SolvaPay accepts, and only when the owner opted in. */
export const PROMPT_EXCERPT_MAX = 1500

export interface PromptFacts {
  /** `sha256:` over the prompt's normalised text. */
  promptHash: string
  /** The prompt carries a tool result marked as an error. */
  toolError: boolean
  /** Its last 1,500 characters; sent only when the owner opted in. */
  excerpt: string
}

export function promptFacts(text: string, toolError = false): PromptFacts {
  return unwrap<PromptFacts>(agentPromptFacts(text, toolError))
}
