import React from 'react';

/**
 * Simple spinner component using CSS animations
 */
export const Spinner: React.FC<{ className?: string; size?: 'sm' | 'md' | 'lg' }> = ({ 
  className = '', 
  size = 'md' 
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-2',
  };

  return (
    <div
      className={`inline-block border-gray-300 border-t-gray-600 rounded-full animate-spin ${sizeClasses[size]} ${className}`}
      role="status"
      aria-busy="true"
    />
  );
};

