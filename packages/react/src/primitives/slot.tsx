/**
 * Vendored copy of @radix-ui/react-slot (MIT-licensed).
 *
 * Slot merges its props with its single child and forwards its ref.
 * Use together with `asChild` to let consumers compose primitives with
 * their own elements (e.g. `<Button asChild><Link /></Button>`).
 *
 * Slottable marks the "child of the child" when Slot wants to render
 * surrounding content around a slotted node.
 */

import React from 'react'
import { composeRefs } from './composeRefs'

interface SlotProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode
}

export const Slot = React.forwardRef<HTMLElement, SlotProps>((props, forwardedRef) => {
  const { children, ...slotProps } = props
  const childrenArray = React.Children.toArray(children)
  const slottable = childrenArray.find(isSlottable)

  if (slottable) {
    // The slotted child is the `<Slottable>`'s child; render siblings around it.
    const newElement = slottable.props.children as React.ReactNode

    const newChildren = childrenArray.map(child => {
      if (child === slottable) {
        if (React.Children.count(newElement) > 1) return React.Children.only(null)
        return React.isValidElement(newElement)
          ? (newElement.props as { children?: React.ReactNode }).children
          : null
      }
      return child
    })

    return (
      <SlotClone {...slotProps} ref={forwardedRef}>
        {React.isValidElement(newElement)
          ? React.cloneElement(newElement, undefined, newChildren)
          : null}
      </SlotClone>
    )
  }

  return (
    <SlotClone {...slotProps} ref={forwardedRef}>
      {children}
    </SlotClone>
  )
})
Slot.displayName = 'Slot'

interface SlotCloneProps {
  children: React.ReactNode
}

const SlotClone = React.forwardRef<unknown, SlotCloneProps & Record<string, unknown>>(
  (props, forwardedRef) => {
    const { children, ...slotProps } = props

    if (React.isValidElement(children)) {
      const childProps = (children.props ?? {}) as Record<string, unknown>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const childRef = getElementRef(children as React.ReactElement<any>)
      const props = mergeProps(slotProps, childProps)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cloneProps: Record<string, any> = { ...props }
      if (forwardedRef) {
        cloneProps.ref = childRef ? composeRefs(forwardedRef, childRef) : forwardedRef
      } else {
        cloneProps.ref = childRef
      }
      return React.cloneElement(children, cloneProps)
    }

    return React.Children.count(children) > 1 ? React.Children.only(null) : null
  },
)
SlotClone.displayName = 'SlotClone'

export const Slottable = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>
}

function isSlottable(
  child: React.ReactNode,
): child is React.ReactElement<{ children?: React.ReactNode }> {
  return React.isValidElement(child) && child.type === Slottable
}

function mergeProps(
  slotProps: Record<string, unknown>,
  childProps: Record<string, unknown>,
): Record<string, unknown> {
  // Child props override slot props, except for handlers/refs/style/className
  // where we merge so consumer intent survives alongside primitive behavior.
  const overrideProps: Record<string, unknown> = { ...childProps }

  for (const propName in slotProps) {
    const slotPropValue = slotProps[propName]
    const childPropValue = childProps[propName]

    const isHandler = /^on[A-Z]/.test(propName)
    if (isHandler) {
      if (slotPropValue && childPropValue) {
        overrideProps[propName] = (...args: unknown[]) => {
          ;(childPropValue as (...a: unknown[]) => unknown)(...args)
          // Respect preventDefault from the child handler
          const first = args[0] as { defaultPrevented?: boolean } | undefined
          if (!first?.defaultPrevented) {
            ;(slotPropValue as (...a: unknown[]) => unknown)(...args)
          }
        }
      } else if (slotPropValue) {
        overrideProps[propName] = slotPropValue
      }
    } else if (propName === 'style') {
      overrideProps[propName] = {
        ...(slotPropValue as object),
        ...(childPropValue as object),
      }
    } else if (propName === 'className') {
      overrideProps[propName] = [slotPropValue, childPropValue].filter(Boolean).join(' ')
    } else if (propName === 'ref') {
      // ref is handled separately via composeRefs in SlotClone
    } else if (childPropValue === undefined) {
      overrideProps[propName] = slotPropValue
    }
  }

  return overrideProps
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getElementRef(element: React.ReactElement<any>): React.Ref<unknown> | null {
  // React 19 exposes ref as a normal prop; older React exposes it on the element object.
  // Try both and fall back to null.
  type RefBearing = {
    props?: { ref?: React.Ref<unknown> }
    ref?: React.Ref<unknown>
  }
  const el = element as unknown as RefBearing
  return el.props?.ref ?? el.ref ?? null
}
