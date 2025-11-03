'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// Force dynamic rendering to prevent build-time errors
export const dynamic = 'force-dynamic';

/**
 * OAuth Callback Content
 * 
 * Handles the OAuth callback from Supabase after Google sign-in.
 * Waits for Supabase session to be established, then redirects to API route
 * that will generate the authorization code and redirect to OpenAI.
 */
function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Check for error in URL params
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');
        
        if (error) {
          console.error('OAuth error:', error, errorDescription);
          router.push('/?error=' + encodeURIComponent(error || 'oauth_error'));
          return;
        }

        // Supabase automatically exchanges the code for a session when the callback URL is accessed
        // Wait a moment for Supabase to process the callback, then check for session
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session) {
          console.error('Session error:', sessionError);
          router.push('/?error=' + encodeURIComponent('session_error'));
          return;
        }

        // Redirect to API route that will generate authorization code and redirect
        window.location.href = '/api/oauth/callback';
      } catch (err) {
        console.error('Callback error:', err);
        router.push('/?error=' + encodeURIComponent('callback_error'));
      }
    };

    handleCallback();
  }, [router, searchParams]);

  return (
    <div className="flex justify-center items-center min-h-screen px-4">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto mb-4"></div>
        <p className="text-slate-600">Completing sign in...</p>
      </div>
    </div>
  );
}

/**
 * OAuth Callback Page
 * 
 * Wraps the callback content in Suspense to handle Next.js searchParams
 */
export default function AuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex justify-center items-center min-h-screen px-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mx-auto mb-4"></div>
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <AuthCallbackContent />
    </Suspense>
  );
}

