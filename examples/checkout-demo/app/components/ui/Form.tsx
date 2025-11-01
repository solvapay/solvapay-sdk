import React from 'react';

interface FormProps {
  children: React.ReactNode;
  title?: string;
  description?: string;
  className?: string;
}

export const Form: React.FC<FormProps> = ({
  children,
  title,
  description,
  className = '',
}) => {
  return (
    <div className={`bg-white/80 backdrop-blur-sm rounded-xl shadow-sm border border-slate-200/60 p-5 ${className}`}>
      {title && (
        <h2 className="text-lg font-semibold text-slate-900 mb-1">{title}</h2>
      )}
      {description && (
        <p className="text-sm text-slate-600 mb-4">{description}</p>
      )}
      {children}
    </div>
  );
};

