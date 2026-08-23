/**
 * Idempotent bootstrap snapshot served at `solvapay://bootstrap.json`.
 *
 * Widgets read this via `app.readServerResource` when the host scrubs
 * `structuredContent` from the opening `toolresult` notification (e.g.
 * MCPJam's AI-SDK `toModelOutput` path). Resource reads bypass chat
 * cards and model-output scrubbing — same auth context as tool calls.
 */

export const SOLVAPAY_BOOTSTRAP_URI = 'solvapay://bootstrap.json'
export const SOLVAPAY_BOOTSTRAP_MIME_TYPE = 'application/json'
