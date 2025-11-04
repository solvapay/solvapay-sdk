import { NextRequest, NextResponse } from 'next/server';
import { createPaymentIntent } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { planRef, agentRef } = await request.json();

  if (!planRef || !agentRef) {
    return NextResponse.json(
      { error: 'Missing required parameters: planRef and agentRef are required' },
      { status: 400 }
    );
  }

  const result = await createPaymentIntent(request, { planRef, agentRef });
  return result instanceof NextResponse ? result : NextResponse.json(result);
}

