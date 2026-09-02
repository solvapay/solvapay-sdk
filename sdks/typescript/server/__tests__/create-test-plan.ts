#!/usr/bin/env node
/**
 * Helper script to create a test plan with free units
 *
 * Usage:
 *   export SOLVAPAY_SECRET_KEY="sp_sandbox_your_key_here"
 *   export SOLVAPAY_API_BASE_URL="http://localhost:3010"
 *   npx tsx sdks/typescript/server/__tests__/create-test-plan.ts
 */

import { createSolvaPayClient } from '../src/index'

const USAGE_METER = 'requests'
const INCLUDED_UNITS = 5

async function createTestPlan() {
  const apiKey = process.env.SOLVAPAY_SECRET_KEY
  const apiBaseUrl = process.env.SOLVAPAY_API_BASE_URL

  if (!apiKey) {
    console.error('❌ SOLVAPAY_SECRET_KEY environment variable is required')
    process.exit(1)
  }

  // No default: the SDK routes are served by the API gateway, and guessing the
  // wrong port yields a confusing 404 instead of a missing-config error.
  if (!apiBaseUrl) {
    console.error('❌ SOLVAPAY_API_BASE_URL environment variable is required')
    console.error('   Local dev gateway is typically http://localhost:3010')
    process.exit(1)
  }

  console.log('🔧 Creating test plan with free units...')
  console.log(`   Backend: ${apiBaseUrl}`)
  console.log()

  const client = createSolvaPayClient({ apiKey, apiBaseUrl })

  try {
    // Step 1: Get first product
    console.log('Step 1: Fetching products...')
    const products = await client.listProducts!()

    if (!products || products.length === 0) {
      console.error('❌ No products found. Create a product first.')
      console.log('\nTo create a product:')
      console.log(`  curl -X POST ${apiBaseUrl}/v1/sdk/products \\`)
      console.log('    -H "Authorization: Bearer $SOLVAPAY_SECRET_KEY" \\')
      console.log('    -H "Content-Type: application/json" \\')
      console.log('    -d \'{"name": "Test Product", "description": "Product for testing"}\'')
      process.exit(1)
    }

    const product = products[0]
    console.log(`✅ Using product: ${product.name} (${product.reference})`)
    console.log()

    // Resolve the provider's default currency so the plan passes the backend's
    // currency-consistency check (e.g. SEK-only providers).
    const merchant = await client.getMerchant!()
    const currency = merchant?.defaultCurrency || 'USD'

    // Step 2: Create plan with free units
    console.log(`Step 2: Creating plan with ${INCLUDED_UNITS} free units (${currency})...`)
    const plan = await client.createPlan!({
      productRef: product.reference,
      name: `SDK Test Plan ${Date.now()}`,
      currency,
      options: [
        // A limit option needs a metered charge to attach to; a zero rate makes
        // the included units a hard allowance rather than billable overage.
        {
          kind: 'charge',
          per: 'unit',
          amountMinor: 0,
          currency: currency.toLowerCase(),
          meter: USAGE_METER,
        },
        {
          kind: 'limit',
          cap: INCLUDED_UNITS,
          scope: 'billing_period',
          meter: USAGE_METER,
          onExceed: 'block',
        },
        // Free plans are auto-assigned so a new customer is covered on first call.
        { kind: 'autoAssigned' },
      ],
    })

    console.log()
    console.log('✅ Plan created successfully!')
    console.log()
    console.log('📋 Plan Details:')
    console.log(`   Reference: ${plan.reference}`)
    console.log(`   Product: ${product.reference}`)
    console.log(`   Free Units: ${INCLUDED_UNITS}`)
    console.log()
    console.log('🎉 You can now run integration tests with:')
    console.log(`   export USE_REAL_BACKEND=true`)
    console.log(`   export SOLVAPAY_SECRET_KEY="${apiKey}"`)
    console.log(`   export SOLVAPAY_API_BASE_URL="${apiBaseUrl}"`)
    console.log(`   pnpm test:integration`)
    console.log()
  } catch (error) {
    console.error('❌ Failed to create test plan:')
    console.error(error)
    process.exit(1)
  }
}

createTestPlan()
