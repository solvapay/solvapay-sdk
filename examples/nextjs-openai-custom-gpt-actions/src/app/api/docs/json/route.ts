import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export async function GET() {
  try {
    const serverUrl =
      process.env.PUBLIC_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    if (!serverUrl) {
      return NextResponse.json(
        {
          error:
            'Server misconfiguration: Missing PUBLIC_URL environment variable. This prevents serving a valid OpenAPI specification with placeholder URLs.',
        },
        { status: 500 },
      )
    }

    const specPath = path.join(process.cwd(), 'generated/openapi.json')

    if (!fs.existsSync(specPath)) {
      return NextResponse.json(
        {
          error: 'OpenAPI specification not found. Run "pnpm generate:docs" to generate it.',
        },
        { status: 404 },
      )
    }

    const specContent = fs.readFileSync(specPath, 'utf8')
    const openApiSpec = JSON.parse(specContent)

    const specString = JSON.stringify(openApiSpec)
    if (specString.includes('your-domain') || specString.includes('your-subdomain')) {
      return NextResponse.json(
        {
          error:
            'Invalid OpenAPI specification: Contains placeholder URLs. Please regenerate with proper environment variables.',
        },
        { status: 500 },
      )
    }

    return NextResponse.json(openApiSpec)
  } catch (error) {
    console.error('Failed to serve OpenAPI spec:', error)
    return NextResponse.json(
      {
        error: 'Failed to load OpenAPI specification',
      },
      { status: 500 },
    )
  }
}
