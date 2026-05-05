import React, { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleGenAI, type Chat } from '@google/genai'
import { usePurchase, useBalance } from '@solvapay/react'
import { Message as MessageType, UserType, ScenarioType, TopUpSelection } from './types'
import { useFocusBus } from './components/focus/FocusProvider'
import { ChatWindow } from './components/ChatWindow'
import { env } from './src/lib/env'

const FREE_MESSAGE_LIMIT = 2

const SYSTEM_INSTRUCTION =
  "You are a helpful assistant. Keep responses brief and conversational. Only mention pricing if asked: Subscription $9.99/month, Credits $2/100 or $4/200 (1 credit = 1 message), Day Pass $5/24hrs. Otherwise, just answer the user's questions normally."

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

const App: React.FC = () => {
  const [messages, setMessages] = useState<MessageType[]>([])
  const [isBotThinking, setIsBotThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showInlineForm, setShowInlineForm] = useState(false)
  const [isFirstMessage, setIsFirstMessage] = useState(true)
  const [currentScenario, setCurrentScenario] = useState<ScenarioType>(ScenarioType.SUBSCRIPTION)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const { requestChatInputFocus } = useFocusBus()

  const chatRef = useRef<Chat | null>(null)
  const userMessageCount = useRef(0)

  // Wire scenario state to live SolvaPay data via SDK hooks.
  const { purchases, refetch: refetchPurchase } = usePurchase()
  const { credits, refetch: refetchBalance } = useBalance()

  const isPremium = useMemo(() => getActivePurchaseFor(purchases, 'recurring'), [purchases])
  const hasDayPass = useMemo(() => getActivePurchaseFor(purchases, 'one-time'), [purchases])
  const creditCount = credits ?? 0

  useEffect(() => {
    try {
      if (!env.geminiApiKey) {
        throw new Error('VITE_GEMINI_API_KEY is not set. Add it to .env to enable chat.')
      }
      const ai = new GoogleGenAI({ apiKey: env.geminiApiKey })
      chatRef.current = ai.chats.create({
        model: 'gemini-3-flash-preview',
        config: { systemInstruction: SYSTEM_INSTRUCTION },
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to initialize Gemini chat')
    }
  }, [])

  const resetChatSession = () => {
    if (!env.geminiApiKey) return
    try {
      const ai = new GoogleGenAI({ apiKey: env.geminiApiKey })
      chatRef.current = ai.chats.create({
        model: 'gemini-3-flash-preview',
        config: { systemInstruction: SYSTEM_INSTRUCTION },
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset chat')
    }
  }

  const handleSendMessage = async (message: string) => {
    if (!chatRef.current) {
      setError('Chat is not initialized. Please check your API key.')
      return
    }

    const willShowPaywall =
      currentScenario === ScenarioType.SUBSCRIPTION
        ? !isPremium && userMessageCount.current + 1 > FREE_MESSAGE_LIMIT
        : currentScenario === ScenarioType.TOPUP
          ? userMessageCount.current + 1 > FREE_MESSAGE_LIMIT && creditCount <= 0
          : userMessageCount.current + 1 > FREE_MESSAGE_LIMIT && !hasDayPass

    setMessages(prev => [...prev, { id: Date.now(), text: message, sender: UserType.USER }])
    userMessageCount.current += 1
    setIsFirstMessage(false)

    if (willShowPaywall) {
      setPendingMessage(message)
      return
    }

    await processMessage(message)
  }

  const processMessage = async (message: string) => {
    if (!chatRef.current) return

    setIsBotThinking(true)
    setError(null)

    try {
      const stream = await chatRef.current.sendMessageStream({ message })
      let botResponse = ''
      const botMessageId = Date.now() + 1
      let firstChunk = true

      for await (const chunk of stream) {
        const chunkText = chunk.text ?? ''
        botResponse += chunkText

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
  }

  const handleUnlock = () => setShowInlineForm(true)

  const handleFormSuccess = (_selection?: TopUpSelection) => {
    setShowInlineForm(false)

    // Refresh SolvaPay state so isPremium / hasDayPass / credits update.
    refetchPurchase().catch(() => {})
    refetchBalance().catch(() => {})

    if (pendingMessage) {
      processMessage(pendingMessage)
      setPendingMessage(null)
    }

    requestChatInputFocus()
  }

  const handleReset = () => {
    setMessages([])
    setShowInlineForm(false)
    userMessageCount.current = 0
    setIsFirstMessage(true)
    setPendingMessage(null)
    resetChatSession()
    requestChatInputFocus()
  }

  const handleScenarioChange = (scenario: ScenarioType) => {
    setCurrentScenario(scenario)
    setMessages([])
    setShowInlineForm(false)
    userMessageCount.current = 0
    setIsFirstMessage(true)
    setPendingMessage(null)
    resetChatSession()
    requestChatInputFocus()
  }

  const showPaywall =
    currentScenario === ScenarioType.SUBSCRIPTION
      ? !isPremium && userMessageCount.current >= FREE_MESSAGE_LIMIT
      : currentScenario === ScenarioType.TOPUP
        ? userMessageCount.current >= FREE_MESSAGE_LIMIT && creditCount <= 0
        : userMessageCount.current >= FREE_MESSAGE_LIMIT && !hasDayPass

  return (
    <div className="h-screen w-screen flex flex-col font-sans bg-gradient-to-br from-slate-50 to-slate-100/50">
      <div className="flex justify-center pt-3 pb-1 px-4">
        <div className="flex bg-white/80 backdrop-blur-sm rounded-full p-1 shadow-sm border border-slate-200/60 gap-1">
          {[
            { id: ScenarioType.SUBSCRIPTION, label: 'Upgrade to Subscription' },
            { id: ScenarioType.TOPUP, label: 'Top Up Credits' },
            { id: ScenarioType.DAYPASS, label: 'Day Pass' },
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
            userMessageCount={userMessageCount.current}
            messageLimit={FREE_MESSAGE_LIMIT}
            onReset={handleReset}
            isFirstMessage={isFirstMessage}
            isPremium={isPremium}
            currentScenario={currentScenario}
            credits={creditCount}
            hasDayPass={hasDayPass}
            showInlineForm={showInlineForm}
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
