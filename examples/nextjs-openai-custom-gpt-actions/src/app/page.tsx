'use client'

import { useState, useEffect } from 'react'

export default function Home() {
  const [apiUrl, setApiUrl] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    // Get the current window URL to build the full API URL
    setApiUrl(`${window.location.origin}/api/docs/json`)
  }, [])

  const copyToClipboard = () => {
    navigator.clipboard.writeText(apiUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8 md:p-24 max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold mb-4 text-center">SolvaPay Custom GPT Actions API</h1>
      <p className="text-xl mb-12 text-center text-gray-600 max-w-2xl">
        This is a backend API for OpenAI Custom GPT Actions.
        It provides a Tasks API secured by Supabase Auth and monetized with SolvaPay.
      </p>

      <div className="w-full bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden mb-12">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">OpenAPI Specification URL</h2>
          <p className="text-sm text-gray-500">Copy this URL to import into your Custom GPT</p>
        </div>
        <div className="p-6 flex flex-col md:flex-row gap-4 items-center">
          <code className="flex-1 p-4 bg-gray-100 rounded-lg text-sm font-mono break-all w-full">
            {apiUrl || 'Loading...'}
          </code>
          <button
            onClick={copyToClipboard}
            className="px-6 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap font-medium min-w-[120px]"
          >
            {copied ? 'Copied!' : 'Copy URL'}
          </button>
        </div>
      </div>

      <div className="w-full max-w-2xl space-y-6">
        <h2 className="text-2xl font-bold text-gray-900">How to Use</h2>
        
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">1</div>
            <div>
              <h3 className="font-semibold text-gray-900">Create a Custom GPT</h3>
              <p className="text-gray-600">Go to <a href="https://chat.openai.com/create" target="_blank" className="text-blue-600 hover:underline">ChatGPT</a> and create a new GPT.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">2</div>
            <div>
              <h3 className="font-semibold text-gray-900">Add Action</h3>
              <p className="text-gray-600">In the "Configure" tab, click "Create new action" and select "Import from URL".</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">3</div>
            <div>
              <h3 className="font-semibold text-gray-900">Paste URL</h3>
              <p className="text-gray-600">Paste the URL you copied above. OpenAI will automatically import the API definition.</p>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold">4</div>
            <div>
              <h3 className="font-semibold text-gray-900">Configure Auth</h3>
              <p className="text-gray-600">Set Authentication Type to <strong>OAuth</strong> using the credentials from your Supabase project.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
