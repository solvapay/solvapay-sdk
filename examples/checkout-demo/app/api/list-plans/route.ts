import { NextRequest, NextResponse } from 'next/server';
import { listPlans } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await listPlans(request);
  return result instanceof NextResponse ? result : NextResponse.json(result);
}

