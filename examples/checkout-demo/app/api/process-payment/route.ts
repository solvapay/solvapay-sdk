import { NextRequest, NextResponse } from 'next/server';
import { processPayment } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { paymentIntentId, agentRef, planRef } = await request.json();
  
  if (!paymentIntentId || !agentRef) {
    return NextResponse.json(
      { error: 'paymentIntentId and agentRef are required' },
      { status: 400 }
    );
  }
  
  const result = await processPayment(request, { paymentIntentId, agentRef, planRef });
  return result;
}

