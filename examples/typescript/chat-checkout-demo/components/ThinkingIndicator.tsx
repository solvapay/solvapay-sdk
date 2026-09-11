import React from 'react'

export const ThinkingIndicator: React.FC = () => {
  return (
    <div className="flex justify-start px-4 py-3">
      <div className="w-3 h-3 bg-slate-500 rounded-full animate-pulse"></div>
    </div>
  )
}
