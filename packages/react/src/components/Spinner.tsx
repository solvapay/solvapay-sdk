import React from 'react'

/**
 * SDK-scoped SVG spinner. Self-contained: SVG `width`/`height` and inline
 * stroke/fill opacity guarantee the visual regardless of consumer CSS.
 * Rotation is driven by the `[data-solvapay-spinner]` rule in `styles.css`,
 * so it only animates when consumers import `@solvapay/react/styles.css`
 * (or target the attribute themselves).
 */
const SIZE_PX = { sm: 16, md: 20, lg: 24 } as const

export const Spinner: React.FC<{
  className?: string
  size?: keyof typeof SIZE_PX
}> = ({ className, size = 'md' }) => {
  const px = SIZE_PX[size]
  return (
    <svg
      data-solvapay-spinner=""
      className={className}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
        strokeOpacity="0.25"
      />
      <path
        fill="currentColor"
        fillOpacity="0.75"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}
