import { NextRequest, NextResponse } from 'next/server'
import { listPlans } from '@solvapay/next'

function buildPlansFetchError(baseUrl: string): string {
  return (
    'Failed to fetch plans: SolvaPay API is unreachable at SOLVAPAY_API_BASE_URL. ' +
    `Current value: ${baseUrl}. Ensure that API is up (e.g. local backend on :3001 behind your ngrok tunnel). ` +
    'The demo app itself runs on localhost and is unrelated to this URL.'
  )
}

export async function GET(request: NextRequest) {
  const apiBaseUrl = process.env.SOLVAPAY_API_BASE_URL ?? 'not configured'

  try {
    const response = await listPlans(request)
    if (response.status < 500) {
      return response
    }

    return NextResponse.json(
      {
        error: buildPlansFetchError(apiBaseUrl),
      },
      { status: response.status },
    )
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      {
        error: `${buildPlansFetchError(apiBaseUrl)} (${message})`,
      },
      { status: 502 },
    )
  }
}
