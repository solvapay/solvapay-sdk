import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import React, { createRef, forwardRef } from 'react'
import { Slot, Slottable } from './slot'

describe('Slot', () => {
  it('merges props onto its child', () => {
    const { getByTestId } = render(
      <Slot data-testid="node" data-from-slot="yes" className="from-slot">
        <a href="#target" className="from-child" data-from-child="yes">
          link
        </a>
      </Slot>,
    )

    const node = getByTestId('node')
    expect(node.tagName).toBe('A')
    expect(node.getAttribute('href')).toBe('#target')
    expect(node.getAttribute('data-from-slot')).toBe('yes')
    expect(node.getAttribute('data-from-child')).toBe('yes')
    expect(node.className).toContain('from-slot')
    expect(node.className).toContain('from-child')
  })

  it('forwards data-* and aria-* attributes to the child', () => {
    const { getByTestId } = render(
      <Slot
        data-testid="node"
        data-state="selected"
        aria-pressed="true"
        aria-label="card"
      >
        <button type="button">child</button>
      </Slot>,
    )
    const node = getByTestId('node')
    expect(node.getAttribute('data-state')).toBe('selected')
    expect(node.getAttribute('aria-pressed')).toBe('true')
    expect(node.getAttribute('aria-label')).toBe('card')
  })

  it('merges refs from Slot and child', () => {
    const slotRef = createRef<HTMLButtonElement>()
    const childRef = createRef<HTMLButtonElement>()

    const Wrapper = forwardRef<HTMLButtonElement>((_, ref) => (
      <Slot ref={ref}>
        <button ref={childRef} type="button">
          child
        </button>
      </Slot>
    ))
    Wrapper.displayName = 'Wrapper'

    render(<Wrapper ref={slotRef} />)

    expect(slotRef.current).toBeInstanceOf(HTMLButtonElement)
    expect(childRef.current).toBe(slotRef.current)
  })

  it('chains event handlers between Slot and child', () => {
    const slotClick = vi.fn()
    const childClick = vi.fn()

    const { getByTestId } = render(
      <Slot data-testid="node" onClick={slotClick}>
        <button type="button" onClick={childClick}>
          child
        </button>
      </Slot>,
    )

    fireEvent.click(getByTestId('node'))

    expect(childClick).toHaveBeenCalledOnce()
    expect(slotClick).toHaveBeenCalledOnce()
  })

  it('skips Slot-provided handler when child calls preventDefault', () => {
    const slotClick = vi.fn()
    const childClick = vi.fn((e: React.MouseEvent) => e.preventDefault())

    const { getByTestId } = render(
      <Slot data-testid="node" onClick={slotClick}>
        <button type="button" onClick={childClick}>
          child
        </button>
      </Slot>,
    )

    fireEvent.click(getByTestId('node'))

    expect(childClick).toHaveBeenCalledOnce()
    expect(slotClick).not.toHaveBeenCalled()
  })
})

describe('Slottable', () => {
  it('lets Slot render content around a single slotted child', () => {
    const { getByTestId } = render(
      <Slot data-testid="node" className="wrapper">
        <span>before</span>
        <Slottable>
          <a href="#target" className="child">
            link
          </a>
        </Slottable>
        <span>after</span>
      </Slot>,
    )

    const node = getByTestId('node')
    expect(node.tagName).toBe('A')
    expect(node.getAttribute('href')).toBe('#target')
    expect(node.textContent).toBe('beforelinkafter')
    expect(node.className).toContain('wrapper')
    expect(node.className).toContain('child')
  })
})
