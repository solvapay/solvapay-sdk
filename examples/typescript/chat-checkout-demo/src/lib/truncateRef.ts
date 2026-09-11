/**
 * Render a customer ref as `anon_xxxx…` for compact display. Keeps the
 * `anon_` prefix intact so it stays obvious this is a demo identity.
 */
export function truncateRef(ref: string, head = 8): string {
  if (ref.length <= head) return ref
  return `${ref.slice(0, head)}…`
}
