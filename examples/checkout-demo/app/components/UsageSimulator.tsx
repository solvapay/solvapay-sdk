'use client'

import { useState } from 'react'
import { useBalance, usePurchase } from '@solvapay/react'
import Link from 'next/link'
import { getAccessToken } from '../lib/supabase'

const EXAMPLE_QUERIES = [
  'How does vector indexing work?',
  'Explain semantic search ranking',
  'What is RAG architecture?',
  'Compare embedding models',
]

export function UsageSimulator() {
  const { credits, adjustBalance } = useBalance()
  const { activePurchase } = usePurchase()

  const productRef = activePurchase?.productRef
  const creditsPerUnit = activePurchase?.planSnapshot?.creditsPerUnit ?? 1000

  const [query, setQuery] = useState(EXAMPLE_QUERIES[0])
  const [sessionQueries, setSessionQueries] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isExhausted = credits != null && credits <= 0

  async function handleRunQuery() {
    if (isRunning || isExhausted) return

    setIsRunning(true)
    setError(null)

    adjustBalance(-creditsPerUnit)

    try {
      const token = await getAccessToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/track-usage', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          actionType: 'api_call',
          units: 1,
          productRef,
          description: query,
          metadata: { toolName: 'knowledge_search', query },
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Request failed')
      }

      setSessionQueries(prev => prev + 1)
    } catch (err) {
      adjustBalance(creditsPerUnit)
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="mt-8 border-2 border-dashed border-slate-300 rounded-2xl p-6 relative">
      <span className="absolute -top-3 left-4 bg-white px-2 text-xs font-medium text-slate-500 uppercase tracking-wider">
        Usage Simulator
      </span>

      <p className="text-sm text-slate-500 mb-4">
        Simulate a knowledge-base search that consumes credits per query.
      </p>

      {/* Stats row */}
      <div className="flex items-center gap-6 mb-4 text-sm">
        <div>
          <span className="text-slate-500">Credits: </span>
          <span className="font-semibold text-slate-900">
            {credits != null ? new Intl.NumberFormat().format(credits) : '---'}
          </span>
        </div>
        <div>
          <span className="text-slate-500">Cost per query: </span>
          <span className="font-semibold text-slate-900">
            {new Intl.NumberFormat().format(creditsPerUnit)}
          </span>
        </div>
        <div>
          <span className="text-slate-500" data-testid="session-queries">
            <span>{sessionQueries}</span> queries this session
          </span>
        </div>
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Enter a search query..."
          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-300"
        />
        <button
          onClick={handleRunQuery}
          disabled={isRunning || isExhausted}
          className="px-5 py-2.5 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {isRunning ? 'Running...' : 'Run Query'}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          Request failed: {error}
        </div>
      )}

      {/* Paywall state */}
      {isExhausted && (
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-center">
          <p className="text-sm font-medium text-amber-900 mb-2">No credits remaining</p>
          <p className="text-xs text-amber-700 mb-3">Top up your balance to continue running queries.</p>
          <Link
            href="/topup"
            className="inline-block px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 transition-colors"
          >
            Top Up
          </Link>
        </div>
      )}
    </div>
  )
}
