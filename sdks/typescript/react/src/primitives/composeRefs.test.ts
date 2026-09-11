import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { composeRefs, setRef } from './composeRefs'

describe('setRef', () => {
  it('assigns to an object ref', () => {
    const ref = createRef<HTMLDivElement>()
    const node = document.createElement('div')
    setRef(ref, node)
    expect(ref.current).toBe(node)
  })

  it('invokes a function ref with the value', () => {
    const fn = vi.fn()
    const node = document.createElement('div')
    setRef(fn, node)
    expect(fn).toHaveBeenCalledWith(node)
  })

  it('ignores null or undefined refs', () => {
    expect(() => setRef(null, document.createElement('div'))).not.toThrow()
    expect(() => setRef(undefined, document.createElement('div'))).not.toThrow()
  })
})

describe('composeRefs', () => {
  it('forwards to both function and object refs', () => {
    const fn = vi.fn()
    const obj = createRef<HTMLDivElement>()
    const composed = composeRefs(fn, obj)
    const node = document.createElement('div')

    composed(node)

    expect(fn).toHaveBeenCalledWith(node)
    expect(obj.current).toBe(node)
  })

  it('skips null and undefined refs without throwing', () => {
    const fn = vi.fn()
    const composed = composeRefs(null, undefined, fn)
    const node = document.createElement('div')

    composed(node)

    expect(fn).toHaveBeenCalledWith(node)
  })

  it('returns a stable function that accepts null for cleanup', () => {
    const fn = vi.fn()
    const obj = createRef<HTMLDivElement>()
    const composed = composeRefs(fn, obj)

    composed(null)

    expect(fn).toHaveBeenCalledWith(null)
    expect(obj.current).toBeNull()
  })
})
