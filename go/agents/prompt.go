package agents

// What SolvaPay's classifier gets from a call's prompt: a hash of the text,
// whether it carries a failed tool result, and its end, which goes only once
// the owner opted in. Each merchant picks the text from its own protocol (an
// LLM proxy: the last user turn; an MCP tool: its input), so repeats of the
// same text show loops.

import (
	"crypto/sha256"
	"encoding/hex"
	"unicode/utf16"
)

// PromptExcerptMax is the most of a prompt SolvaPay accepts, in UTF-16 code
// units, and only when the owner opted in.
const PromptExcerptMax = 1500

// PromptFacts is what SolvaPay's classifier gets from a prompt.
type PromptFacts struct {
	// PromptHash is "sha256:" over the prompt's UTF-8 text.
	PromptHash string `json:"promptHash"`
	// ToolError says the prompt carries a tool result marked as an error.
	ToolError bool `json:"toolError"`
	// Excerpt is the prompt's last 1,500 UTF-16 code units; sent only when the owner opted in.
	Excerpt string `json:"excerpt"`
}

// NewPromptFacts reads a prompt's facts.
func NewPromptFacts(text string, toolError bool) PromptFacts {
	sum := sha256.Sum256([]byte(text))
	return PromptFacts{
		PromptHash: "sha256:" + hex.EncodeToString(sum[:]),
		ToolError:  toolError,
		Excerpt:    lastUnits(text, PromptExcerptMax),
	}
}

// lastUnits is the last count UTF-16 code units of text, as SolvaPay counts
// the limit (and JavaScript's slice), without the low half of a character the
// cut went through: a lone surrogate is not valid text to send. Go strings are
// UTF-8, so the text is counted in UTF-16 first.
func lastUnits(text string, count int) string {
	units := utf16.Encode([]rune(text))
	if len(units) <= count {
		return text
	}
	end := units[len(units)-count:]
	if end[0] >= 0xdc00 && end[0] <= 0xdfff {
		end = end[1:]
	}
	return string(utf16.Decode(end))
}
