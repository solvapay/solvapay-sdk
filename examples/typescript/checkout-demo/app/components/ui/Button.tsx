import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon' | 'action' | 'outline'
  children: React.ReactNode
  isLoading?: boolean
  loadingText?: string
}

const baseClasses =
  'font-medium transition-all duration-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2'

const variantClasses = {
  primary:
    'px-4 py-2.5 text-sm text-white bg-slate-900 rounded-full hover:bg-slate-800 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed',
  secondary:
    'px-4 py-2 text-xs text-slate-600 bg-transparent rounded-full hover:text-slate-900 hover:bg-slate-50',
  icon: 'p-1.5 text-slate-400 bg-transparent rounded-lg hover:text-slate-700 hover:bg-slate-50',
  action:
    'w-full py-2.5 text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2',
  outline:
    'w-full py-2.5 border-2 border-slate-300 text-slate-900 rounded-lg hover:border-red-500 hover:text-red-600 disabled:opacity-50 disabled:cursor-not-allowed',
}

export const actionButtonClassName = variantClasses.action
  .split(' ')
  .concat(baseClasses.split(' '))
  .join(' ')

export function Button({
  variant = 'primary',
  children,
  className = '',
  isLoading = false,
  loadingText = 'Processing...',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${isLoading ? 'flex items-center justify-center gap-2' : ''} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>{loadingText}</span>
        </>
      ) : (
        children
      )}
    </button>
  )
}
