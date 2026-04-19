/**
 * Compose a consumer-provided event handler with an internal handler.
 * The consumer handler runs first; the internal handler is skipped when
 * the consumer calls `event.preventDefault()` (unless opted out).
 *
 * Mirrors the Radix UI helper so primitive leaves can safely chain
 * user handlers with their own state updates.
 */
export function composeEventHandlers<E extends { defaultPrevented: boolean }>(
  originalEventHandler?: ((event: E) => void) | undefined,
  ourEventHandler?: ((event: E) => void) | undefined,
  { checkForDefaultPrevented = true }: { checkForDefaultPrevented?: boolean } = {},
): (event: E) => void {
  return function handleEvent(event) {
    originalEventHandler?.(event)

    if (checkForDefaultPrevented === false || !event.defaultPrevented) {
      ourEventHandler?.(event)
    }
  }
}
