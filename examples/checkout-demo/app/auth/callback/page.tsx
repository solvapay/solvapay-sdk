'use client';

import { useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabase, getAccessToken } from '../../lib/supabase';

// Mark page as dynamic since it uses searchParams
export const dynamic = 'force-dynamic';

/**
 * OAuth Callback Content
 * 
 * Handles the OAuth callback from Supabase after Google sign-in.
 * Supabase automatically exchanges the code for a session when the callback URL is accessed.
 * We verify the session was created, sync the customer in SolvaPay, then redirect.
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
          // Redirect to home page with error (will show auth form)
          router.push('/');
          return;
        }

        // Supabase automatically exchanges the code for a session when the callback URL is accessed
        // Wait a moment for Supabase to process the callback, then check for session
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Session error:', sessionError);
          router.push('/');
          return;
        }

        if (session) {
          // User is signed in - redirect to home page
          // The auth state change listener in layout.tsx will handle customer sync
          // No need to sync here - let the layout/provider handle it to avoid duplicate calls
          router.push('/');
        } else {
          // No session found - redirect to home page (will show auth form)
          router.push('/');
        }
      } catch (err) {
        console.error('Callback error:', err);
        router.push('/');
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

