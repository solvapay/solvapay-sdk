import React from 'react'

export const SparklesIcon: React.FC<{ className?: string }> = ({ className = 'h-6 w-6' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3L9.27 9.27L3 12l6.27 2.73L12 21l2.73-6.27L21 12l-6.27-2.73z"></path>
    <path d="M4.5 4.5l1 1"></path>
    <path d="M18.5 4.5l-1 1"></path>
    <path d="M18.5 18.5l-1-1"></path>
    <path d="M4.5 18.5l1-1"></path>
  </svg>
)
