import { NextRequest } from 'next/server';
import { listPlans } from '@solvapay/next';

export async function GET(request: NextRequest) {
  const result = await listPlans(request);
  return result;
}

