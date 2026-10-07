import { NextRequest } from 'next/server'
import { saveCard } from '@solvapay/next'

// The body is the captured card with its return URL, or the completion of a
// pending setup after 3DS; `saveCard` validates it.
export async function POST(request: NextRequest) {
  return saveCard(request, await request.json())
}
