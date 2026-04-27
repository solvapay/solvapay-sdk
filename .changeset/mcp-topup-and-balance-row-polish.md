---
'@solvapay/react': patch
---

Three small MCP polish fixes for the host iframe surfaces:

- **`<McpTopupView>` Pay-with-card step.** Collapsed the duplicated back
  affordance (top `← Back to my account` + bottom `← Change amount`)
  into a single `← Change amount` link at the top of the card. Mirrors
  the pattern already used by the PAYG payment step and removes the
  ambiguity of two competing back buttons on the same surface. The
  amount-picker and success steps keep their `Back to my account` link
  unchanged.

- **`<McpAccountView>` balance row.** The inline `Top up` button on the
  "Credit balance" card now hugs its label and sits flush right
  instead of stretching across half the row. Achieved with a scoped
  `.solvapay-mcp-balance-row .solvapay-mcp-button { width: auto }`
  override; the same `.solvapay-mcp-button` class keeps its full-width
  default everywhere else (plan picker, topup confirm, portal
  launcher).

- **`<BackLink>` hover styling.** The hover-state underline used to
  render as two segments with a gap between the arrow and the label
  (the flex `gap` between the glyph and label spans broke the
  underline). Now the underline is scoped to the label span only, so
  it reads as one continuous line — and the arrow gets a subtle 2px
  leftward nudge on hover to reinforce the "back" semantics. Also
  refined `text-underline-offset` / `text-decoration-thickness` so the
  underline sits a touch below the baseline instead of crowding the
  text.
