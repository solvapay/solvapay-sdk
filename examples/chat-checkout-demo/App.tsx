import React, { useCallback, useMemo, useRef, useState } from 'react'
import { usePurchase, useBalance, usePlans, useTransport } from '@solvapay/react'
import type { PaywallStructuredContent } from '@solvapay/server'
import { Message as MessageType, UserType, ScenarioType, TopUpSelection } from './types'
import { useFocusBus } from './components/focus/FocusProvider'
import { ChatWindow } from './components/ChatWindow'
import { env } from './src/lib/env'
import { getAnonymousCustomerRef } from './src/lib/anonymousCustomer'

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
  const [showInlineForm, setShowInlineForm] = useState(false)
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [currentScenario, setCurrentScenario] = useState<ScenarioType>(ScenarioType.SUBSCRIPTION)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [paywallContent, setPaywallContent] = useState<PaywallStructuredContent | null>(null)
  const { requestChatInputFocus } = useFocusBus()

  const userMessageCount = useRef(0)
  const customerRef = useMemo(() => getAnonymousCustomerRef(), [])

  const { purchases, refetch: refetchPurchase } = usePurchase()
  const { credits, refetch: refetchBalance, adjustBalance } = useBalance()

  const isPremium = useMemo(() => getActivePurchaseFor(purchases, 'recurring'), [purchases])
  const hasLifetimeAccess = useMemo(() => getActivePurchaseFor(purchases, 'one-time'), [purchases])
  const creditCount = credits ?? 0

  const productRef = productRefForScenario(currentScenario)

  // Pull the active scenario's plans so the header pill / tooltip can
  // surface the *real* free-tier limit. The backend is authoritative
  // for gating; this is purely UX so the user knows how many free
  // messages remain in the current product.
  const transport = useTransport()
  const planFetcher = useCallback(
    async (ref: string) => {
      if (!transport.listPlans) throw new Error('Transport does not support listPlans')
      return transport.listPlans(ref)
    },
    [transport],
  )
  const { plans, loading: plansLoading } = usePlans({
    productRef: productRef || undefined,
    fetcher: planFetcher,
  })
  const messageLimit = useMemo(() => {
    const free = plans
      .map(p => p.freeUnits ?? 0)
      .filter(n => n > 0)
      .sort((a, b) => b - a)[0]
    return free ?? 0
  }, [plans])

  // The metered plan's `creditsPerUnit` is what the backend debits per
  // chat send. Mirrors the same calculation in `ChatWindow` so the
  // optimistic decrement matches what the badge will display.
  const creditsPerMessage = useMemo(() => {
    const meteredPlan = plans.find(p => p.type === 'usage-based')
    return Math.max(meteredPlan?.creditsPerUnit ?? 1, 1)
  }, [plans])

  const processMessage = useCallback(
    async (
      message: string,
      opts?: { historyOverride?: MessageType[]; retryOn402?: number },
    ) => {
      if (!productRef) {
        setError(
          `No product configured for the ${currentScenario} scenario. Set the matching VITE_*_PRODUCT_REF in .env.`,
        )
        return
      }

      // Optimistically debit the wallet so the header pill ("X MSGS
      // LEFT") updates the moment the user submits, instead of waiting
      // for the streaming response to finish before `refetchBalance`
      // pulls the real value. `adjustBalance` blocks `refetch` for an
      // 8s grace period, so the existing reconcile call below stays
      // consistent. We revert below on a 402 (gate fires before
      // `trackUsage` server-side, so no debit happened); transient
      // errors fall through and the post-grace refetch reconciles.
      const shouldOptimisticDebit =
        currentScenario === ScenarioType.TOPUP && creditsPerMessage > 0
      if (shouldOptimisticDebit) {
        adjustBalance(-creditsPerMessage)
      }

      setIsBotThinking(true)
      setError(null)

      const history = opts?.historyOverride ?? messages
      const wireMessages = [
        ...history.map(m => ({
          role: m.sender === UserType.BOT ? ('bot' as const) : ('user' as const),
          text: m.text,
        })),
        { role: 'user' as const, text: message },
      ]

      const maxAttempts = (opts?.retryOn402 ?? 0) + 1

      try {
        let response: Response | null = null
        let payload402: ({ kind?: string } & PaywallStructuredContent) | null = null

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-customer-ref': customerRef,
            },
            body: JSON.stringify({ productRef, messages: wireMessages }),
          })

          if (response.status !== 402) break

          payload402 = (await response.json()) as { kind?: string } & PaywallStructuredContent

          // Silent retry path: post-purchase replays may race the
          // SolvaPay webhook that credits the customer. Wait with a
          // small backoff and try again before falling back to the
          // paywall UI. 1s + 2s + 3s + 4s = 10s of total wait covers
          // typical webhook latency without surfacing a flicker.
          if (attempt < maxAttempts - 1) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 1000))
            response = null
          }
        }

        if (response?.status === 402 && payload402) {
          if (shouldOptimisticDebit) adjustBalance(creditsPerMessage)
          if (
            payload402.kind === 'payment_required' ||
            payload402.kind === 'activation_required'
          ) {
            setPaywallContent(payload402 as PaywallStructuredContent)
          }
          setPendingMessage(message)
          setIsBotThinking(false)
          return
        }

        if (!response || !response.ok || !response.body) {
          throw new Error(`Chat request failed: ${response?.status ?? 'no response'}`)
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
        // the balance so the header pill tracks the real remainder
        // instead of going stale at the post-purchase value.
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
    [
      productRef,
      currentScenario,
      messages,
      customerRef,
      refetchBalance,
      adjustBalance,
      creditsPerMessage,
    ],
  )

  const handleSendMessage = async (message: string) => {
    setMessages(prev => [...prev, { id: Date.now(), text: message, sender: UserType.USER }])
    userMessageCount.current += 1
    setIsFirstMessage(false)
    await processMessage(message)
  }

  const handleUnlock = () => {
    setShowInlineForm(true)
    setIsFirstMessage(false)
  }

  const handleFormSuccess = (_selection?: TopUpSelection) => {
    setShowInlineForm(false)
    setPaywallContent(null)

    refetchPurchase().catch(() => {})
    refetchBalance().catch(() => {})

    // Poll the balance for ~10s so the header pill converges on the
    // real backend value once the webhook lands. `useBalance` only
    // auto-fetches once on mount; without these follow-ups the badge
    // can stick at 0 if the initial fetch raced ahead of the customer
    // being created or the webhook crediting the wallet.
    for (const ms of [1000, 3000, 6000, 10000]) {
      window.setTimeout(() => {
        refetchBalance().catch(() => {})
      }, ms)
    }

    if (pendingMessage) {
      const retry = pendingMessage
      setPendingMessage(null)
      // The SolvaPay webhook that credits the customer fires async
      // after Stripe confirms (typically 1–3s, occasionally longer).
      // `/api/chat` is gated server-side via `checkLimits`, so we
      // ride the silent 402-retry path in `processMessage` to wait
      // out the webhook before falling back to the paywall.
      processMessage(retry, { retryOn402: 4 }).catch(() => {})
    }

    requestChatInputFocus()
  }

  const handleReset = () => {
    setMessages([])
    setShowInlineForm(false)
    userMessageCount.current = 0
    setIsFirstMessage(true)
    setPendingMessage(null)
    setPaywallContent(null)
    requestChatInputFocus()
  }

  const handleScenarioChange = (scenario: ScenarioType) => {
    setCurrentScenario(scenario)
    setMessages([])
    setShowInlineForm(false)
    userMessageCount.current = 0
    setIsFirstMessage(true)
    setPendingMessage(null)
    setPaywallContent(null)
    requestChatInputFocus()
  }

  const showPaywall = paywallContent !== null

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
            showPaywall={showPaywall}
            onUnlock={handleUnlock}
            onUpgrade={handleUnlock}
            userMessageCount={userMessageCount.current}
            messageLimit={messageLimit}
            plans={plans}
            plansLoading={plansLoading}
            productRef={productRef}
            onReset={handleReset}
            isFirstMessage={isFirstMessage}
            isPremium={isPremium}
            currentScenario={currentScenario}
            credits={creditCount}
            hasLifetimeAccess={hasLifetimeAccess}
            showInlineForm={showInlineForm}
            paywallContent={paywallContent}
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
