import React from 'react'

/**
 * Decorative "opens in a new tab" glyph — a small square with an arrow
 * emerging from its top-right corner. Rendered next to link labels that
 * escape the current surface (customer portal, hosted checkout, footer
 * Terms/Privacy, …). Inherits color via `currentColor`; sized with inline
 * width/height so it's robust even if consumers don't ship our CSS.
 *
 * Screen-reader hidden by design — the surrounding anchor carries the
 * meaningful `aria-label="… (opens in a new tab)"`.
 */
export const ExternalLinkGlyph: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      className={`solvapay-mcp-external-glyph${className ? ` ${className}` : ''}`}
      width="0.9em"
      height="0.9em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="m10 14 11-11" />
    </svg>
  )
}
