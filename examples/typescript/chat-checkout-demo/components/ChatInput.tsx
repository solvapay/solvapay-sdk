import React, { useState } from 'react'
import { useInputFocus } from './focus/useInputFocus'
import { useFocusBus } from './focus/FocusProvider'

interface ChatInputProps {
  onSendMessage: (message: string) => void
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage }) => {
  const [inputValue, setInputValue] = useState('')
  const { focusSignal } = useFocusBus()
  const { inputRef, focus } = useInputFocus<HTMLInputElement>({
    autoFocus: true,
    deps: [focusSignal],
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim()) {
      onSendMessage(inputValue.trim())
      setInputValue('')
      focus()
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        <form onSubmit={handleSubmit} className="relative group">
          <div className="relative bg-white border border-slate-200/80 rounded-3xl shadow-sm hover:shadow-md focus-within:shadow-lg transition-all duration-300">
            <div className="flex items-center">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder="Type your message..."
                className="flex-1 pl-6 pr-16 py-4 bg-transparent border-none rounded-3xl text-base placeholder-slate-500 focus:outline-none resize-none"
                aria-label="Chat input"
              />
              <button
                type="submit"
                style={{ transform: 'translateY(-50%)', transformOrigin: 'center center' }}
                className={`absolute right-3 top-1/2 flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 focus:outline-none ${
                  inputValue.trim()
                    ? 'bg-slate-900 text-white hover:bg-slate-800 hover:scale-105 active:scale-95 shadow-md hover:shadow-lg'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
                disabled={!inputValue.trim()}
                aria-label="Send message"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            </div>
          </div>

          <div className="mt-3 text-center">
            <p className="text-xs text-slate-400">
              Press Enter to send • Shift + Enter for new line
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
