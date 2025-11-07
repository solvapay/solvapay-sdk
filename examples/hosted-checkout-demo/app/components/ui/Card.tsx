import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'glass';
  style?: React.CSSProperties;
}

export function Card({
  children,
  className = '',
  variant = 'default',
  style,
}: CardProps) {
  const baseClasses = 'rounded-2xl shadow-xl border border-slate-200/60';
  
  const variantClasses = {
    default: 'bg-white',
    glass: 'bg-white/95 backdrop-blur-lg',
  };

  return (
    <div className={`${baseClasses} ${variantClasses[variant]} ${className}`} style={style}>
      {children}
    </div>
  );
}

