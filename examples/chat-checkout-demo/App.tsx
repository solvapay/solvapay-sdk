import React, { useCallback, useMemo, useRef, useState } from 'react'
import { getOrCreateAnonymousCustomerRef, usePurchase, useBalance, usePlans } from '@solvapay/react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { Message as MessageType, UserType, ScenarioType } from './types'
import { useFocusBus } from './components/focus/FocusProvider'
import { ChatWindow } from './components/ChatWindow'
import type { InlineCheckoutMode } from './components/InlineCheckout'
import { env } from './src/lib/env'

function getActivePurchaseFor(
  purchases: Array<{ planSnapshot?: { planType?: string }; status?: string; endDate?: string }>,
  planType: 'recurring' | 'one-time',
): boolean {
  const now = Date.now()
  return purchases.some(p => {
    if (p.planSnapshot?.planType !== planType) return false
    if (p.status !== 'active') return false
    if (p.endDate && new Date(p.endDate).getTime() <= now) return false
    return true
  })
}

function productRefForScenario(scenario: ScenarioType): string {
  switch (scenario) {
    case ScenarioType.SUBSCRIPTION:
      return env.subscription.productRef
    case ScenarioType.LIFETIME:
      return env.lifetime.productRef
    case ScenarioType.TOPUP:
      return env.topup.productRef
  }
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<MessageType[]>([])
  const [isBotThinking, setIsBotThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [currentScenario, setCurrentScenario] = useState<ScenarioType>(ScenarioType.SUBSCRIPTION)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  // Discriminated union — either a real 402 paywall (`paywall`) drives
  // `<PaywallNotice.EmbeddedCheckout>`, or a proactive "Upgrade" click
  // (`upgrade`) drives a bare `<CheckoutSteps.*>` composition. Earlier
  // revisions minted a synthetic `payment_required` block for the
  // upgrade case; routing on `mode` keeps the paywall surface honest.
  const [checkoutState, setCheckoutState] = useState<InlineCheckoutMode | null>(null)
  const { requestChatInputFocus } = useFocusBus()

  const userMessageCount = useRef(0)
  const customerRef = useMemo(() => getOrCreateAnonymousCustomerRef(), [])

  const { purchases } = usePurchase()
  const { credits, refetch: refetchBalance } = useBalance()

  const isPremium = useMemo(() => getActivePurchaseFor(purchases, 'recurring'), [purchases])
  const hasLifetimeAccess = useMemo(() => getActivePurchaseFor(purchases, 'one-time'), [purchases])
  const creditCount = credits ?? 0

  const productRef = productRefForScenario(currentScenario)

  // Pull the active scenario's plans so the header pill / tooltip can
  // surface the *real* free-tier limit. The backend is authoritative
  // for gating; this is purely UX so the user knows how many free
  // messages remain in the current product. `usePlans` defaults to
  // `defaultListPlans` (which routes through the configured transport
  // when present, or `/api/list-plans` otherwise), so no fetcher
  // wiring is required here.
  const { plans, loading: plansLoading } = usePlans({
    productRef: productRef || undefined,
  })
  const messageLimit = useMemo(() => {
    const free = plans
      .map(p => p.freeUnits ?? 0)
      .filter(n => n > 0)
      .sort((a, b) => b - a)[0]
    return free ?? 0
  }, [plans])

  const processMessage = useCallback(
    async (message: string, history: MessageType[]) => {
      if (!productRef) {
        setError(
          `No product configured for the ${currentScenario} scenario. Set the matching VITE_*_PRODUCT_REF in .env.`,
        )
        return
      }

      setIsBotThinking(true)
      setError(null)

      const wireMessages = [
        ...history.map(m => ({
          role: m.sender === UserType.BOT ? ('bot' as const) : ('user' as const),
          text: m.text,
        })),
        { role: 'user' as const, text: message },
      ]

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-customer-ref': customerRef,
          },
          body: JSON.stringify({ productRef, messages: wireMessages }),
        })

        if (response.status === 402) {
          // The server emitted a structured paywall — store it so the
          // inline `<PaywallNotice>` checkout can take over and drive
          // resolution via `usePaywallResolver`. The pending message
          // replays automatically once `onResolved` fires.
          const payload = (await response.json()) as PaywallStructuredContent
          setCheckoutState({ mode: 'paywall', content: payload })
          setPendingMessage(message)
          setIsBotThinking(false)
          return
        }

        if (!response.ok || !response.body) {
          throw new Error(`Chat request failed: ${response.status}`)
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let botResponse = ''
        const botMessageId = Date.now() + 1
        let firstChunk = true

        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.trim()) continue
            let event: { chunk?: string; error?: string }
            try {
              event = JSON.parse(line) as { chunk?: string; error?: string }
            } catch {
              continue
            }
            if (event.error) {
              throw new Error(event.error)
            }
            if (!event.chunk) continue
            botResponse += event.chunk
            if (firstChunk) {
              setMessages(prev => [
                ...prev,
                { id: botMessageId, text: botResponse, sender: UserType.BOT },
              ])
              firstChunk = false
            } else {
              setMessages(prev =>
                prev.map(m => (m.id === botMessageId ? { ...m, text: botResponse } : m)),
              )
            }
          }
        }

        // Each chat send debits `creditsPerUnit` from the wallet on
        // the backend (via `trackUsage` in the chat handler). Refetch
        // the balance so the header pill tracks the real remainder.
        // The SDK's 8s `adjustBalance` grace window handles transient
        // staleness during checkout; no extra polling needed.
        refetchBalance().catch(() => {})
      } catch (e) {
        const errorMessage = 'An error occurred while fetching the response. Please try again.'
        setError(errorMessage)
        setMessages(prev => [
          ...prev,
          { id: Date.now() + 1, text: errorMessage, sender: UserType.BOT },
        ])
        console.error(e)
      } finally {
        setIsBotThinking(false)
      }
    },
    [productRef, currentScenario, customerRef, refetchBalance],
  )

  const handleSendMessage = async (message: string) => {
    setMessages(prev => {
      const next = [...prev, { id: Date.now(), text: message, sender: UserType.USER }]
      // `processMessage` reads history from the closure, so capture
      // the pre-update value for the wire payload.
      void processMessage(message, prev)
      return next
    })
    userMessageCount.current += 1
    setIsFirstMessage(false)
  }

  /**
   * The user clicked "Upgrade" before hitting a real 402. Open the
   * stepped checkout drawer in `upgrade` mode — no synthetic
   * paywall content needed. `<CheckoutSteps.*>` drives the plan →
   * amount → payment flow and `onPurchaseSuccess` calls back into
   * `handleFormSuccess`.
   */
  const handleUpgrade = () => {
    if (!productRef) return
    setIsFirstMessage(false)
    setCheckoutState({ mode: 'upgrade', productRef })
  }

  const handleFormSuccess = () => {
    setCheckoutState(null)
    if (pendingMessage) {
      const retry = pendingMessage
      setPendingMessage(null)
      // Replay using the most recent message history. By this point
      // `usePaywallResolver` has already confirmed the customer's
      // entitlement on the SDK side, so the server-side `checkLimits`
      // will pass on the next call.
      processMessage(retry, messages).catch(() => {})
    }
    requestChatInputFocus()
  }

  const handleReset = () => {
    setMessages([])
    userMessageCount.current = 0
    setIsFirstMessage(true)
    setPendingMessage(null)
    setCheckoutState(null)
    requestChatInputFocus()
  }

  const handleScenarioChange = (scenario: ScenarioType) => {
    setCurrentScenario(scenario)
    setMessages([])
    userMessageCount.current = 0
    setIsFirstMessage(true)
    setPendingMessage(null)
    setCheckoutState(null)
    requestChatInputFocus()
  }

  return (
    <div className="h-screen w-screen flex flex-col font-sans bg-gradient-to-br from-slate-50 to-slate-100/50">
      <div className="flex justify-center pt-3 pb-1 px-4">
        <div className="flex bg-white/80 backdrop-blur-sm rounded-full p-1 shadow-sm border border-slate-200/60 gap-1">
          {[
            { id: ScenarioType.SUBSCRIPTION, label: 'Upgrade to Subscription' },
            { id: ScenarioType.TOPUP, label: 'Top Up Credits' },
            { id: ScenarioType.LIFETIME, label: 'Lifetime Access' },
          ].map(({ id, label }) => (
            <button
              key={id}
              onClick={() => handleScenarioChange(id)}
              className={`px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                currentScenario === id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <main className="flex-1 overflow-hidden p-3 md:p-6 pt-2">
        <div className="h-full w-full max-w-5xl mx-auto bg-white/95 rounded-2xl shadow-xl border border-slate-200/60 flex flex-col backdrop-blur-lg">
          <ChatWindow
            messages={messages}
            isBotThinking={isBotThinking}
            onSendMessage={handleSendMessage}
            onUpgrade={handleUpgrade}
            userMessageCount={userMessageCount.current}
            messageLimit={messageLimit}
            plans={plans}
            plansLoading={plansLoading}
            onReset={handleReset}
            isFirstMessage={isFirstMessage}
            isPremium={isPremium}
            currentScenario={currentScenario}
            credits={creditCount}
            hasLifetimeAccess={hasLifetimeAccess}
            checkoutState={checkoutState}
            onFormSuccess={handleFormSuccess}
          />
        </div>
        {error && (
          <div
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg shadow-lg"
            role="alert"
          >
            <strong className="font-bold">Error: </strong>
            <span className="block sm:inline">{error}</span>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
