'use client'

import { useState, useEffect } from 'react'

export default function DocsPage() {
  const [openApiSpec, setOpenApiSpec] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadOpenApiSpec()
  }, [])

  const loadOpenApiSpec = async () => {
    try {
      setLoading(true)
      setError(null)
      
      const response = await fetch('/api/docs/json')
      if (response.ok) {
        const spec = await response.json()
        setOpenApiSpec(spec)
      } else {
        setError('Failed to load API documentation')
      }
    } catch (err) {
      setError('Network error: ' + (err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const openSwaggerUI = () => {
    window.open('/api/docs', '_blank')
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-0">
        <div className="flex items-center justify-center min-h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">Loading API documentation...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-0">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">API Documentation</h1>
        <p className="text-lg text-gray-600">
          Interactive API documentation for SolvaPay Custom GPT Actions.
        </p>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span className="text-sm font-medium text-red-800">{error}</span>
          </div>
        </div>
      )}

      {/* Interactive Swagger UI */}
      <div className="bg-white shadow rounded-lg p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Interactive API Explorer</h2>
        <p className="text-gray-600 mb-4">
          Use the interactive Swagger UI to explore and test all API endpoints.
        </p>
        <button
          onClick={openSwaggerUI}
          className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700"
        >
          Open Swagger UI
        </button>
      </div>

      {/* API Overview */}
      {openApiSpec && (
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">API Overview</h2>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium text-gray-900">{openApiSpec.info?.title}</h3>
              <p className="text-gray-600">{openApiSpec.info?.description}</p>
              <p className="text-sm text-gray-500 mt-2">
                Version: {openApiSpec.info?.version} | 
                OpenAPI: {openApiSpec.openapi}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Available Endpoints */}
      {openApiSpec && (
        <div className="bg-white shadow rounded-lg p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Available Endpoints</h2>
          <div className="space-y-4">
            {Object.entries(openApiSpec.paths || {}).map(([path, methods]: [string, any]) => (
              <div key={path} className="border border-gray-200 rounded-lg p-4">
                <h3 className="text-lg font-medium text-gray-900 mb-2">{path}</h3>
                <div className="space-y-2">
                  {Object.entries(methods).map(([method, details]: [string, any]) => (
                    <div key={method} className="flex items-center space-x-3">
                      <span className={`text-xs px-2 py-1 rounded font-medium ${
                        method === 'get' ? 'bg-blue-100 text-blue-800' :
                        method === 'post' ? 'bg-green-100 text-green-800' :
                        method === 'put' ? 'bg-yellow-100 text-yellow-800' :
                        method === 'delete' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {method.toUpperCase()}
                      </span>
                      <span className="text-sm text-gray-700">{details.summary || details.operationId}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Quick Links</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <h3 className="text-sm font-medium text-gray-900">Swagger UI</h3>
            <p className="text-sm text-gray-600">Interactive API documentation</p>
          </a>
          
          <a
            href="/api/docs/json"
            target="_blank"
            rel="noopener noreferrer"
            className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <h3 className="text-sm font-medium text-gray-900">OpenAPI JSON</h3>
            <p className="text-sm text-gray-600">Raw OpenAPI specification</p>
          </a>
          
          <a
            href="/api/openapi.json"
            target="_blank"
            rel="noopener noreferrer"
            className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <h3 className="text-sm font-medium text-gray-900">Custom GPT Schema</h3>
            <p className="text-sm text-gray-600">OpenAI Custom GPT Actions schema</p>
          </a>
          
          <a
            href="/api/healthz"
            target="_blank"
            rel="noopener noreferrer"
            className="block p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <h3 className="text-sm font-medium text-gray-900">Health Check</h3>
            <p className="text-sm text-gray-600">API health status</p>
          </a>
        </div>
      </div>
    </div>
  )
}
