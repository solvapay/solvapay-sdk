import React from 'react';

type BadgeVariant = 'premium' | 'free' | 'credits' | 'daypass';

interface BadgeProps {
  children: React.ReactNode;
  variant: BadgeVariant;
  className?: string;
}

export function Badge({
  children,
  variant,
  className = '',
}: BadgeProps) {
  const variantClasses = {
    premium: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    free: 'bg-slate-100 text-slate-600 border-slate-200',
    credits: 'bg-blue-100 text-blue-700 border-blue-200',
    daypass: 'bg-purple-100 text-purple-700 border-purple-200',
  };

  return (
    <span
      className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

