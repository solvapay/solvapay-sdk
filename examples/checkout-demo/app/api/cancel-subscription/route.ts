import { NextRequest, NextResponse } from 'next/server';
import { cancelSubscription } from '@solvapay/next';

export async function POST(request: NextRequest) {
  const { subscriptionRef, reason } = await request.json();

  if (!subscriptionRef) {
    return NextResponse.json(
      { error: 'Missing required parameter: subscriptionRef is required' },
      { status: 400 }
    );
  }

  const result = await cancelSubscription(request, { subscriptionRef, reason });
  return result;
}

