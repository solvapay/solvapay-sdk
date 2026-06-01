import React from 'react'

interface StarterPromptsProps {
  onSelect: (prompt: string) => void
}

const PROMPTS = [
  'Explain how usage-based pricing works for AI products',
  'Write a launch tweet for a new payments SDK',
  'Help me brainstorm names for a fintech startup',
  'Summarize the differences between subscription, top-up, and lifetime access billing',
]

export const StarterPrompts: React.FC<StarterPromptsProps> = ({ onSelect }) => {
  return (
    <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
      {PROMPTS.map(prompt => (
        <button
          key={prompt}
          type="button"
          onClick={() => onSelect(prompt)}
          className="group text-left px-4 py-3 rounded-2xl border border-slate-200/70 bg-white/70 hover:bg-white hover:border-slate-300 hover:shadow-sm transition-all duration-200"
        >
          <span className="text-sm text-slate-700 group-hover:text-slate-900 leading-snug">
            {prompt}
          </span>
        </button>
      ))}
    </div>
  )
}
