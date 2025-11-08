import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, existsSync, unlinkSync, readFileSync } from 'fs'
import { join } from 'path'
import { setupTestEnvironment } from './test-utils'

describe('Example Configuration Tests', () => {
  const USER_PLANS_FILE = join(process.cwd(), 'user-plans.json')

  setupTestEnvironment()

  beforeEach(() => {
    // Clean up user plans file before each test
    if (existsSync(USER_PLANS_FILE)) {
      unlinkSync(USER_PLANS_FILE)
    }
  })

  afterEach(() => {
    // Clean up user plans file after each test
    if (existsSync(USER_PLANS_FILE)) {
      unlinkSync(USER_PLANS_FILE)
    }
  })

  describe('Configuration Management', () => {
    it('should have user plans file management', () => {
      // Test that user-plans.json can be created and managed
      const testPlan = {
        'test_user': {
          plan: 'pro', 
          upgradedAt: new Date().toISOString()
        }
      }
      
      writeFileSync(USER_PLANS_FILE, JSON.stringify(testPlan, null, 2))
      expect(existsSync(USER_PLANS_FILE)).toBe(true)
      
      const content = readFileSync(USER_PLANS_FILE, 'utf-8')
      const parsed = JSON.parse(content)
      expect(parsed.test_user.plan).toBe('pro')
    })

    it('should use SolvaPay SDK for paywall functionality', () => {
      // This test verifies that the example is configured to use the SDK
      // The actual paywall functionality is comprehensively tested in the SDK package
      const packageJsonPath = join(process.cwd(), 'package.json')
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      
      // Verify the example depends on the SolvaPay server package
      expect(packageJson.dependencies['@solvapay/server']).toBeDefined()
    })
  })
})