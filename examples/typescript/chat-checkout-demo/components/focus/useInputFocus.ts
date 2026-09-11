import { useCallback, useEffect, useRef } from 'react'

export function useInputFocus<T extends HTMLElement>(options?: {
  autoFocus?: boolean
  deps?: unknown[]
}) {
  const inputRef = useRef<T>(null)
  const focus = useCallback((opts?: FocusOptions) => inputRef.current?.focus(opts), [])

  useEffect(
    () => {
      if (options?.autoFocus) {
        requestAnimationFrame(() => focus())
      }
    },
    options?.deps ?? [options?.autoFocus],
  )

  return { inputRef, focus }
}
