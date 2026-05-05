import React, { useRef, useEffect, useState } from 'react'
import { Message as MessageType, ScenarioType, TopUpSelection as SelectionType } from '../types'
import { Message } from './Message'
import { ChatInput } from './ChatInput'
import { Paywall } from './Paywall'
import { TopUpForm } from './TopUpForm'
import { CheckoutForm } from './CheckoutForm'
import { DayPassForm } from './DayPassForm'
import { ThinkingIndicator } from './ThinkingIndicator'
import { RefreshIcon } from './icons/RefreshIcon'
import { BotIcon } from './icons/BotIcon'
import { useInputFocus } from './focus/useInputFocus'
import { useFocusBus } from './focus/FocusProvider'

const CenteredInput: React.FC<{ onSendMessage: (message: string) => void }> = ({
  onSendMessage,
}) => {
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
    <form onSubmit={handleSubmit} className="relative group">
      <div className="relative bg-white/80 backdrop-blur-sm border border-slate-200/60 rounded-3xl shadow-sm hover:shadow-md focus-within:shadow-lg transition-all duration-300">
        <div className="flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Ask anything"
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
    </form>
  )
}

interface ChatWindowProps {
  messages: MessageType[]
  isBotThinking: boolean
  onSendMessage: (message: string) => void
  showPaywall: boolean
  onUnlock: () => void
  userMessageCount: number
  messageLimit: number
  onReset: () => void
  isFirstMessage: boolean
  isPremium: boolean
  currentScenario: ScenarioType
  credits: number
  hasDayPass: boolean
  showInlineForm: boolean
  onFormSuccess: (selection?: SelectionType) => void
}

export const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  isBotThinking,
  onSendMessage,
  showPaywall,
  onUnlock,
  userMessageCount,
  messageLimit,
  onReset,
  isFirstMessage,
  isPremium,
  currentScenario,
  credits,
  hasDayPass,
  showInlineForm,
  onFormSuccess,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isBotThinking])

  const renderPricingTooltipContent = () => (
    <>
      {currentScenario === ScenarioType.SUBSCRIPTION ? (
        <>
          <div className="font-medium text-slate-800 mb-0.5">Pricing</div>
          <div>Free up to {messageLimit} messages.</div>
          <div>Upgrade for unlimited: $9.99.</div>
        </>
      ) : currentScenario === ScenarioType.TOPUP ? (
        <>
          <div className="font-medium text-slate-800 mb-0.5">Pricing</div>
          <div>Free up to {messageLimit} messages.</div>
          <div>Pay-as-you-go: 1 msg = 1 credit.</div>
          <div>100 credits $2 · 200 credits $4.</div>
        </>
      ) : (
        <>
          <div className="font-medium text-slate-800 mb-0.5">Pricing</div>
          <div>Free up to {messageLimit} messages.</div>
          <div>Day pass: $5 for 24h unlimited.</div>
        </>
      )}
    </>
  )

  const renderHeader = () => (
    <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-sm rounded-t-2xl">
      <div className="flex items-center space-x-2">
        <BotIcon className="h-5 w-5 text-slate-600" />
        <div className="leading-tight">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight">Agent Chat</h1>
            <span
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                currentScenario === ScenarioType.SUBSCRIPTION
                  ? isPremium
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                  : currentScenario === ScenarioType.TOPUP
                    ? credits > 0
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-red-100 text-red-700 border border-red-200'
                    : hasDayPass
                      ? 'bg-purple-100 text-purple-700 border border-purple-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
              }`}
            >
              {currentScenario === ScenarioType.SUBSCRIPTION
                ? isPremium
                  ? 'PAID'
                  : 'FREE'
                : currentScenario === ScenarioType.TOPUP
                  ? `${credits} CREDITS`
                  : hasDayPass
                    ? 'DAY PASS'
                    : 'FREE'}
            </span>
            <div className="relative group/pricing inline-block align-middle">
              <button
                type="button"
                aria-label="Pricing info"
                className="w-5 h-5 rounded-full border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 flex items-center justify-center text-[10px]"
              >
                i
              </button>
              <div className="opacity-0 group-hover/pricing:opacity-100 focus-within:opacity-100 pointer-events-none group-hover/pricing:pointer-events-auto absolute left-1/2 -translate-x-1/2 mt-2 z-20 w-64 rounded-md border border-slate-200 bg-white shadow-lg p-3 text-xs text-slate-600 transition-opacity">
                {renderPricingTooltipContent()}
              </div>
            </div>
          </div>
          <p className="text-xs text-slate-500">Example end-user chat</p>
        </div>
      </div>
      <div className="flex items-center space-x-4">
        <span className="hidden sm:inline px-2 py-0.5 text-[10px] font-medium rounded-full bg-slate-100 text-slate-600 border border-slate-200">
          {Math.min(userMessageCount, messageLimit)} / {messageLimit}
        </span>
        <button
          onClick={onReset}
          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-all duration-200"
          aria-label="Reset chat"
        >
          <RefreshIcon className="h-4 w-4" />
        </button>
      </div>
    </header>
  )

  if (isFirstMessage) {
    return (
      <div className="flex flex-col h-full bg-white rounded-2xl relative">
        {renderHeader()}

        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="text-center mb-8 max-w-3xl mx-auto">
            <h2 className="text-3xl md:text-4xl font-normal text-slate-900 mb-6 tracking-tight leading-tight">
              {currentScenario === ScenarioType.SUBSCRIPTION
                ? 'Where should we begin?'
                : currentScenario === ScenarioType.DAYPASS
                  ? 'Ready to chat?'
                  : "Let's chat!"}
            </h2>
          </div>

          <div className="w-full max-w-3xl px-4">
            <CenteredInput onSendMessage={onSendMessage} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white rounded-2xl">
      {renderHeader()}
      <div className="flex-1 overflow-y-auto px-6 py-6 bg-gradient-to-b from-white to-slate-50/30">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map(msg => (
            <Message key={msg.id} message={msg} />
          ))}
          {isBotThinking && <ThinkingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>
      {showInlineForm ? (
        currentScenario === ScenarioType.SUBSCRIPTION ? (
          <CheckoutForm onSuccess={onFormSuccess} />
        ) : currentScenario === ScenarioType.TOPUP ? (
          <TopUpForm onSuccess={selection => onFormSuccess(selection)} />
        ) : (
          <DayPassForm onSuccess={onFormSuccess} />
        )
      ) : showPaywall ? (
        <Paywall onUnlock={onUnlock} currentScenario={currentScenario} />
      ) : (
        <ChatInput onSendMessage={onSendMessage} />
      )}
    </div>
  )
}
