// This file runs BEFORE any test files are loaded
// Load environment variables from .env file
import 'dotenv/config'

// Force tests to always use stub client (override .env settings)
// This example's tests are designed to test the Express integration,
// not the SDK itself. SDK integration tests live in packages/server/__tests__/
process.env.USE_REAL_BACKEND = 'false'

// Disable debug logging during tests to prevent console spam
process.env.STUB_DEBUG = 'false'
process.env.SOLVAPAY_DEBUG = 'false'
