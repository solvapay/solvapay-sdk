import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'icon';
  children: React.ReactNode;
  isLoading?: boolean;
}

export function Button({
  variant = 'primary',
  children,
  className = '',
  isLoading = false,
  disabled,
  ...props
}: ButtonProps) {
  const baseClasses = 'font-medium transition-all duration-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2';
  
  const variantClasses = {
    primary: 'px-4 py-2.5 text-sm text-white bg-slate-900 rounded-full hover:bg-slate-800 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed',
    secondary: 'px-4 py-2 text-xs text-slate-600 bg-transparent rounded-full hover:text-slate-900 hover:bg-slate-50',
    icon: 'p-1.5 text-slate-400 bg-transparent rounded-lg hover:text-slate-700 hover:bg-slate-50',
  };

  return (
    <button
      className={`${baseClasses} ${variantClasses[variant]} ${className} ${isLoading ? 'flex items-center justify-center' : ''}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="animate-spin mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>Processing...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

