import type { Ref } from 'react'

type PossibleRef<T> = Ref<T> | null | undefined

/**
 * Assign a value to a single ref, whether it's a function ref, object ref,
 * or null/undefined. Mirrors the Radix UI helper so primitives can cleanly
 * forward refs when composed via `asChild`.
 */
export function setRef<T>(ref: PossibleRef<T>, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value)
  } else if (ref !== null && ref !== undefined) {
    ;(ref as { current: T | null }).current = value
  }
}

/**
 * Compose multiple refs into a single callback ref. Forwards the node
 * (or null on unmount) to every provided ref. Null/undefined refs are ignored.
 */
export function composeRefs<T>(...refs: Array<PossibleRef<T>>): (node: T | null) => void {
  return node => {
    for (const ref of refs) {
      setRef(ref, node)
    }
  }
}
