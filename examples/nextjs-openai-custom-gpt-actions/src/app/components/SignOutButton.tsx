'use client'

import { useState } from 'react'

interface SignOutButtonProps {
  accessToken?: string
  onSignOut?: () => void
  className?: string
}

/**
 * Simple sign out button component that demonstrates how to use the sign out API
 */
export function SignOutButton({
  accessToken,
  onSignOut,
  className = 'bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 disabled:opacity-50',
}: SignOutButtonProps) {
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [message, setMessage] = useState<string>('')

  const handleSignOut = async () => {
    setIsSigningOut(true)
    setMessage('')

    try {
      let response: Response

      if (accessToken) {
        // Use Bearer token in header
        response = await fetch('/api/oauth/signout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new FormData(),
        })
      } else {
        // Try to get token from localStorage (example)
        const storedToken = localStorage.getItem('access_token')
        if (!storedToken) {
          setMessage('No access token found')
          return
        }

        const formData = new FormData()
        formData.append('token', storedToken)
        formData.append('token_type_hint', 'access_token')

        response = await fetch('/api/oauth/signout', {
          method: 'POST',
          body: formData,
        })
      }

      if (response.ok) {
        const data = await response.json()
        setMessage(data.message || 'Successfully signed out')

        // Clear local storage
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')

        // Call optional callback
        onSignOut?.()
      } else {
        const errorData = await response.json()
        setMessage(errorData.error_description || 'Sign out failed')
      }
    } catch (error) {
      setMessage(`Sign out error: ${error}`)
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button onClick={handleSignOut} disabled={isSigningOut} className={className}>
        {isSigningOut ? 'Signing out...' : 'Sign Out'}
      </button>

      {message && (
        <p
          className={`text-sm ${message.includes('error') || message.includes('failed') ? 'text-red-600' : 'text-green-600'}`}
        >
          {message}
        </p>
      )}
    </div>
  )
}

/**
 * Example usage:
 *
 * // With access token prop
 * <SignOutButton
 *   accessToken={userToken}
 *   onSignOut={() => router.push('/login')}
 * />
 *
 * // Auto-detect token from localStorage
 * <SignOutButton
 *   onSignOut={() => window.location.reload()}
 * />
 */
