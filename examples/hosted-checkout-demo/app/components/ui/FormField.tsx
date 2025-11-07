import React from 'react';
import { Input } from './Input';

interface FormFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  icon?: React.ReactNode;
}

export function FormField({
  label,
  error,
  icon,
  className = '',
  ...props
}: FormFieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}
      </label>
      <Input
        label="" // Don't duplicate label
        error={error}
        icon={icon}
        className={className}
        {...props}
      />
    </div>
  );
}

