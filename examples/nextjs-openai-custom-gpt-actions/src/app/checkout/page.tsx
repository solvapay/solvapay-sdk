'use client'

import { useEffect } from 'react'
import { getAccessToken } from '@/lib/supabase'

export default function CheckoutPage() {
  useEffect(() => {
    const redirectToHostedCheckout = async () => {
      const agentRef = process.env.NEXT_PUBLIC_AGENT_REF;
      
      if (!agentRef) {
        console.error('Agent reference is not configured');
        return;
      }

      try {
        const accessToken = await getAccessToken();
        
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };
        
        if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`;
        }

        const response = await fetch('/api/create-checkout-session', {
          method: 'POST',
          headers,
          body: JSON.stringify({ agentRef }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = errorData.error || errorData.details || 'Failed to create checkout session';
          throw new Error(errorMessage);
        }

        const { checkoutUrl } = await response.json();

        if (!checkoutUrl) {
          throw new Error('No checkout URL returned');
        }

        // Redirect to hosted checkout page
        window.location.href = checkoutUrl;
      } catch (err) {
        console.error('Failed to redirect to checkout:', err);
        // Show error message or redirect back to home
        window.location.href = '/';
      }
    };

    redirectToHostedCheckout();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Redirecting to Checkout
          </h2>
          <p className="text-gray-600">
            Please wait while we redirect you to the secure checkout page...
          </p>
        </div>
      </div>
    </div>
  )
}
