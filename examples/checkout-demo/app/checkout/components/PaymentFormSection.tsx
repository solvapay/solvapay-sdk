"use client";
import { PaymentForm, type Plan } from '@solvapay/react';
import { formatPrice } from '../utils/planHelpers';

interface PaymentFormSectionProps {
  currentPlan: Plan;
  agentRef?: string;
  onSuccess: (paymentIntent?: any) => void;
  onError: (error: Error) => void;
  onBack: () => void;
}

/**
 * Payment Form Section Component
 * 
 * Wraps the PaymentForm SDK component with plan summary and back button.
 * Parent component ensures this is only rendered with valid plan data.
 */
export function PaymentFormSection({
  currentPlan,
  agentRef,
  onSuccess,
  onError,
  onBack,
}: PaymentFormSectionProps) {
  const price = formatPrice(currentPlan.price);

  return (
    <div className="space-y-6">
      {/* Plan Summary */}
      <div className="pb-6 border-b border-slate-200">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-slate-600">Selected Plan:</span>
          <span className="text-sm font-medium text-slate-900">{currentPlan.name}</span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-600">Total:</span>
          <span className="text-lg font-bold text-slate-900">${price}</span>
        </div>
      </div>

      {/* Payment Form */}
      <PaymentForm
        key={currentPlan.reference}
        planRef={currentPlan.reference}
        agentRef={agentRef}
        onSuccess={onSuccess}
        onError={onError}
        submitButtonText="Complete Purchase"
        className="space-y-6"
        buttonClassName="w-full py-3 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors font-medium disabled:opacity-60 disabled:cursor-not-allowed"
      />

      {/* Back Button */}
      <button
        onClick={onBack}
        className="mt-6 text-sm text-slate-600 hover:text-slate-900 block"
      >
        ← Back to plan selection
      </button>
    </div>
  );
}

