#!/usr/bin/env node
/**
 * Helper script to create a test plan with free units
 *
 * Usage:
 *   export SOLVAPAY_SECRET_KEY="sp_sandbox_your_key_here"
 *   export SOLVAPAY_API_BASE_URL="http://localhost:3001"
 *   npx tsx packages/server/__tests__/create-test-plan.ts
 */

import { createSolvaPayClient } from '../src/index'

async function createTestPlan() {
  const apiKey = process.env.SOLVAPAY_SECRET_KEY
  const apiBaseUrl = process.env.SOLVAPAY_API_BASE_URL || 'http://localhost:3001'

  if (!apiKey) {
    console.error('❌ SOLVAPAY_SECRET_KEY environment variable is required')
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
      console.log('  curl -X POST http://localhost:3001/v1/sdk/products \\')
      console.log('    -H "Authorization: Bearer $SOLVAPAY_SECRET_KEY" \\')
      console.log('    -H "Content-Type: application/json" \\')
      console.log('    -d \'{"name": "Test Product", "description": "Product for testing"}\'')
      process.exit(1)
    }

    const product = products[0]
    console.log(`✅ Using product: ${product.name} (${product.reference})`)
    console.log()

    // Step 2: Create plan with free units
    console.log('Step 2: Creating plan with 5 free units...')
    const plan = await client.createPlan!({
      name: `SDK Test Plan ${Date.now()}`,
      productRef: product.reference,
      isFreeTier: true,
      freeUnits: 5,
      description: 'Test plan with 5 free requests for SDK integration tests',
    })

    console.log()
    console.log('✅ Plan created successfully!')
    console.log()
    console.log('📋 Plan Details:')
    console.log(`   Name: ${plan.name}`)
    console.log(`   Reference: ${plan.reference}`)
    console.log(`   Product: ${product.reference}`)
    console.log(`   Free Units: 5`)
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
