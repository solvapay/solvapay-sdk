'use client';

import { useState } from 'react';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Form } from './ui/Form';
import { signUp, signIn, getAccessToken } from '../lib/supabase';

export function Auth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [signUpSuccess, setSignUpSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    setSignUpSuccess(false);

    try {
      if (isSignUp) {
        const { data, error: signUpError } = await signUp(email, password);
        if (signUpError) throw signUpError;
        
        // Check if user was immediately signed in (no email confirmation required)
        if (data.session) {
          // User is signed in immediately - sync customer in SolvaPay
          try {
            const accessToken = await getAccessToken();
            if (accessToken) {
              // Call sync-customer endpoint to eagerly create customer
              await fetch('/api/sync-customer', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${accessToken}`,
                },
              }).catch((err) => {
                // Silent failure - don't block signup if customer creation fails
                console.warn('Failed to sync customer after signup:', err);
              });
            }
          } catch (err) {
            // Silent failure - don't block signup if customer creation fails
            console.warn('Failed to sync customer after signup:', err);
          }
          // User is signed in immediately - auth state change will handle navigation
          // Don't set loading to false here, let auth state change handle it
          setIsLoading(false);
          return;
        } else {
          // Email confirmation required
          setSignUpSuccess(true);
        }
      } else {
        const { error: signInError } = await signIn(email, password);
        if (signInError) throw signInError;
        // Success - auth state change will trigger re-render in layout
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex justify-center items-center min-h-screen px-4">
      <div className="w-full max-w-md">
        <Form
          title={isSignUp ? 'Create Account' : 'Sign In'}
          description={isSignUp ? 'Create a new account to continue' : 'Sign in to your account'}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="email"
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
            />
            <Input
              type="password"
              label="Password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              minLength={6}
            />
            
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                {error}
              </div>
            )}

            {signUpSuccess && (
              <div className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
                Account created! Please check your email to confirm your account, then sign in.
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              isLoading={isLoading}
            >
              {isSignUp ? 'Sign Up' : 'Sign In'}
            </Button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError(null);
                  setSignUpSuccess(false);
                }}
                className="text-sm text-slate-600 hover:text-slate-900 transition-colors"
                disabled={isLoading}
              >
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}

