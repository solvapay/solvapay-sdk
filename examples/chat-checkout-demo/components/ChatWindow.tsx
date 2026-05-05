import React, { useCallback, useRef, useEffect, useState } from 'react'
import { formatPrice, useCustomer, useLocale, usePlans, useTransport, type Plan } from '@solvapay/react'
import type { PaywallStructuredContent } from '@solvapay/server'
import {
  Message as MessageType,
  ScenarioType,
  TopUpSelection as SelectionType,
} from '../types'
import { Message } from './Message'
import { ChatInput } from './ChatInput'
import { Paywall } from './Paywall'
import { TopUpForm } from './TopUpForm'
import { CheckoutForm } from './CheckoutForm'
import { DayPassForm } from './DayPassForm'
import { ThinkingIndicator } from './ThinkingIndicator'
import { RefreshIcon } from './icons/RefreshIcon'
import { IdentityStrip } from './IdentityStrip'
import { CustomerChip } from './CustomerChip'
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
  productRef: string
  onReset: () => void
  isFirstMessage: boolean
  isPremium: boolean
  currentScenario: ScenarioType
  credits: number
  hasDayPass: boolean
  showInlineForm: boolean
  paywallContent: PaywallStructuredContent | null
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
  productRef,
  onReset,
  isFirstMessage,
  isPremium,
  currentScenario,
  credits,
  hasDayPass,
  showInlineForm,
  paywallContent,
  onFormSuccess,
}) => {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const locale = useLocale()
  const { customerRef } = useCustomer()
  const transport = useTransport()
  const fetcher = useCallback(
    async (ref: string) => {
      if (!transport.listPlans) throw new Error('Transport does not support listPlans')
      return transport.listPlans(ref)
    },
    [transport],
  )
  const { plans } = usePlans({ productRef: productRef || undefined, fetcher })
  const paidPlan = plans.find(p => p.requiresPayment !== false && (p.price ?? 0) > 0)
  // The metered plan on a top-up product is the zero-cost usage-based
  // one. Its `creditsPerUnit` (e.g. 10) tells us how many internal
  // credit units a single chat message debits — used to convert the
  // raw `credits` balance into a user-facing "messages remaining"
  // count for the header pill and the tooltip.
  const meteredPlan = plans.find(p => p.type === 'usage-based')
  const creditsPerMessage = Math.max(meteredPlan?.creditsPerUnit ?? 1, 1)
  const messagesRemaining = Math.floor((credits || 0) / creditsPerMessage)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isBotThinking])

  const renderPricingTooltipContent = () => (
    <PricingTooltipContent
      currentScenario={currentScenario}
      messageLimit={messageLimit}
      paidPlan={paidPlan}
      plans={plans}
      locale={locale}
      creditsPerMessage={creditsPerMessage}
    />
  )

  const statusPill = (
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
          ? `${messagesRemaining.toLocaleString()} MSG${messagesRemaining === 1 ? '' : 'S'} LEFT`
          : hasDayPass
            ? 'DAY PASS'
            : 'FREE'}
    </span>
  )

  const pricingTooltip = (
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
  )

  const renderHeader = () => (
    <header className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 bg-white/80 backdrop-blur-sm rounded-t-2xl">
      <IdentityStrip
        fallbackName="Agent Chat"
        fallbackSubline="Example end-user chat"
        trailing={
          <>
            {statusPill}
            {pricingTooltip}
          </>
        }
      />
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <CustomerChip customerRef={customerRef} />
        {messageLimit > 0 && (
          <span className="hidden sm:inline px-2 py-0.5 text-[10px] font-medium rounded-full bg-slate-100 text-slate-600 border border-slate-200">
            {Math.min(userMessageCount, messageLimit)} / {messageLimit}
          </span>
        )}
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
        <Paywall
          onUnlock={onUnlock}
          currentScenario={currentScenario}
          productRef={productRef}
          paywallContent={paywallContent}
        />
      ) : (
        <ChatInput onSendMessage={onSendMessage} />
      )}
    </div>
  )
}

interface PricingTooltipContentProps {
  currentScenario: ScenarioType
  messageLimit: number
  paidPlan: Plan | undefined
  plans: Plan[]
  locale: string | undefined
  creditsPerMessage: number
}

const PricingTooltipContent: React.FC<PricingTooltipContentProps> = ({
  currentScenario,
  messageLimit,
  paidPlan,
  plans,
  locale,
  creditsPerMessage,
}) => {
  const freeLine = messageLimit > 0 ? `Free up to ${messageLimit} messages.` : null

  if (currentScenario === ScenarioType.SUBSCRIPTION) {
    const price = paidPlan
      ? formatPrice(paidPlan.price ?? 0, paidPlan.currency ?? 'USD', {
          locale,
          interval: paidPlan.billingCycle ?? paidPlan.interval,
        })
      : null
    return (
      <>
        <div className="font-medium text-slate-800 mb-0.5">Pricing</div>
        {freeLine && <div>{freeLine}</div>}
        {price ? <div>Upgrade for unlimited: {price}.</div> : <div>Upgrade for unlimited.</div>}
      </>
    )
  }

  if (currentScenario === ScenarioType.TOPUP) {
    const packs = plans
      .filter(p => p.requiresPayment !== false && (p.price ?? 0) > 0)
      .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
    const perMsg =
      creditsPerMessage === 1
        ? 'Pay-as-you-go: 1 credit per message.'
        : `Pay-as-you-go: ${creditsPerMessage} credits per message.`
    return (
      <>
        <div className="font-medium text-slate-800 mb-0.5">Pricing</div>
        {freeLine && <div>{freeLine}</div>}
        <div>{perMsg}</div>
        {packs.length > 0 ? (
          <div>
            {packs
              .map(p => `${p.name ?? p.reference} ${formatPrice(p.price ?? 0, p.currency ?? 'USD', { locale })}`)
              .join(' · ')}
          </div>
        ) : null}
      </>
    )
  }

  // Day pass
  const price = paidPlan
    ? formatPrice(paidPlan.price ?? 0, paidPlan.currency ?? 'USD', { locale })
    : null
  return (
    <>
      <div className="font-medium text-slate-800 mb-0.5">Pricing</div>
      {freeLine && <div>{freeLine}</div>}
      {price ? <div>Day pass: {price} for 24h unlimited.</div> : <div>Day pass: unlimited.</div>}
    </>
  )
}
