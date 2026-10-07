/**
 * How many reconcile rounds a form waits for the bank's answer when the
 * payer authenticates outside the frame (an MCP host opened the bank's
 * page). Each round asks the backend to process the payment, which itself
 * waits for a terminal status before answering `timeout`, and a `timeout`
 * reconcile backs off through purchase refetches; twelve rounds cover a
 * few minutes at the bank.
 */
export const AUTHENTICATION_WAIT_ATTEMPTS = 12
