/**
 * Shared Stub SolvaPay API Client
 *
 * This is a demo implementation that simulates the SolvaPay backend API.
 * Use this for local development and testing without needing a real backend.
 *
 * Features:
 * - Free tier tracking (configurable daily limits)
 * - Customer management
 * - In-memory or file-based persistence
 * - Simulates realistic API delays
 *
 * In production, use createSolvaPayClient() from @solvapay/server instead.
 */

import { promises as fs } from 'fs'
import path from 'path'
import type { SolvaPayClient, CustomerResponseMapped } from '@solvapay/server'

// Re-export the interface from SDK for convenience
export type { SolvaPayClient }

type ListPlansResponse = Awaited<ReturnType<NonNullable<SolvaPayClient['listPlans']>>>
type CreatePaymentIntentResult = Awaited<
  ReturnType<NonNullable<SolvaPayClient['createPaymentIntent']>>
>
type ProcessPaymentResult = Awaited<
  ReturnType<NonNullable<SolvaPayClient['processPaymentIntent']>>
>
type ActivatePlanResult = Awaited<ReturnType<NonNullable<SolvaPayClient['activatePlan']>>>
type CustomerBalanceResult = Awaited<
  ReturnType<NonNullable<SolvaPayClient['getCustomerBalance']>>
>
type ProductResponse = Awaited<ReturnType<NonNullable<SolvaPayClient['getProduct']>>>
type MerchantResponse = Awaited<ReturnType<NonNullable<SolvaPayClient['getMerchant']>>>

interface FreeTierData {
  [customerPlanKey: string]: {
    count: number
    lastReset: string // ISO date string
  }
}

interface CustomerData {
  [customerRef: string]: {
    credits: number
    email?: string
    name?: string
    plan?: 'free' | 'pro' | 'premium'
    externalRef?: string
  }
}

export interface StubClientOptions {
  /**
   * Enable file-based persistence for usage data
   * Default: false (in-memory only)
   */
  useFileStorage?: boolean

  /**
   * Number of free calls per day per plan
   * Default: 3
   */
  freeTierLimit?: number

  /**
   * Directory for storing persistent data (when useFileStorage is true)
   * Default: '.demo-data' in current working directory
   */
  dataDir?: string

  /**
   * Simulate API delays (in milliseconds)
   * Default: { checkLimits: 100, trackUsage: 50, customer: 50 }
   */
  delays?: {
    checkLimits?: number
    trackUsage?: number
    customer?: number
  }

  /**
   * Enable debug logging
   * Default: false
   */
  debug?: boolean

  /**
   * Base URL for checkout and OAuth endpoints
   * Default: process.env.PUBLIC_BASE_URL || process.env.PUBLIC_URL || process.env.OPENAI_ACTIONS_BASE_URL || 'http://localhost:3000'
   */
  baseUrl?: string
}

export class StubSolvaPayClient implements SolvaPayClient {
  private freeTierLimit: number
  private dataDir: string
  private freeTierFile: string
  private customerFile: string
  private useFileStorage: boolean
  private delays: Required<NonNullable<StubClientOptions['delays']>>
  private debug: boolean
  private baseUrl: string

  // In-memory storage
  private inMemoryFreeTier: FreeTierData = {}
  private inMemoryCustomers: CustomerData = {}

  // Simple lock to prevent race conditions with file storage
  private fileLock: Promise<void> = Promise.resolve()

  constructor(options: StubClientOptions = {}) {
    this.useFileStorage = options.useFileStorage ?? false
    this.freeTierLimit = options.freeTierLimit ?? 3
    this.debug = options.debug ?? false
    this.baseUrl =
      options.baseUrl ??
      process.env.PUBLIC_BASE_URL ??
      process.env.PUBLIC_URL ??
      process.env.OPENAI_ACTIONS_BASE_URL ??
      'http://localhost:3000'
    this.delays = {
      checkLimits: options.delays?.checkLimits ?? 100,
      trackUsage: options.delays?.trackUsage ?? 50,
      customer: options.delays?.customer ?? 50,
    }

    // Set up file paths (only used if file storage is enabled)
    this.dataDir = options.dataDir ?? path.join(process.cwd(), '.demo-data')
    this.freeTierFile = path.join(this.dataDir, 'free-tier-usage.json')
    this.customerFile = path.join(this.dataDir, 'customers.json')

    // Log initialization
    this.log('🔌 SolvaPay DEMO/STUB Client initialized')
    this.log('   Mode: In-memory simulation (no real backend)')
    this.log(`   Free tier limit: ${this.freeTierLimit} calls per day per plan`)
    this.log(
      `   Storage: ${this.useFileStorage ? 'File-based (' + this.dataDir + ')' : 'In-memory only'}`,
    )

    // Initialize demo data
    this.initializeDemoCustomers()

    // Set up file storage if requested (synchronously wait for initialization)
    if (this.useFileStorage) {
      // Don't use .then/.catch - we want synchronous initialization for tests
      // This ensures file storage is ready before any API calls
      this.initializeStorage().catch(err => {
        this.log('⚠️  Failed to initialize file storage:', err)
        this.log('⚠️  Falling back to in-memory storage')
        this.useFileStorage = false
      })
    }
  }

  private log(...args: any[]): void {
    if (this.debug) {
      console.log('[DEMO]', ...args)
    }
  }

  /**
   * Initialize demo customers in memory
   */
  private initializeDemoCustomers(): void {
    this.inMemoryCustomers = {
      demo_customer: {
        credits: 100,
        email: 'demo@example.com',
        name: 'Demo Customer',
        externalRef: 'demo_customer',
      },
    }
  }

  /**
   * Initialize persistent storage with demo data (only if file storage enabled)
   */
  private async initializeStorage(): Promise<void> {
    // Create data directory if it doesn't exist
    await fs.mkdir(this.dataDir, { recursive: true })

    // Initialize customer data file if it doesn't exist
    try {
      await fs.access(this.customerFile)
    } catch {
      await fs.writeFile(this.customerFile, JSON.stringify(this.inMemoryCustomers, null, 2))
      this.log('📁 Initialized customer data file')
    }

    // Initialize free tier data file if it doesn't exist
    try {
      await fs.access(this.freeTierFile)
    } catch {
      const initialFreeTier: FreeTierData = {}
      await fs.writeFile(this.freeTierFile, JSON.stringify(initialFreeTier, null, 2))
      this.log('📁 Initialized free tier data file')
    }
  }

  /**
   * Load free tier usage data from storage
   */
  private async loadFreeTierData(): Promise<FreeTierData> {
    if (!this.useFileStorage) {
      return this.inMemoryFreeTier
    }

    try {
      const data = await fs.readFile(this.freeTierFile, 'utf-8')
      return JSON.parse(data)
    } catch {
      return {}
    }
  }

  /**
   * Save free tier usage data to storage
   */
  private async saveFreeTierData(data: FreeTierData): Promise<void> {
    if (!this.useFileStorage) {
      this.inMemoryFreeTier = { ...data }
      return
    }

    try {
      await fs.writeFile(this.freeTierFile, JSON.stringify(data, null, 2))
    } catch (error) {
      this.log('⚠️  Failed to save free tier data:', error)
    }
  }

  /**
   * Load customer data from storage
   */
  private async loadCustomerData(): Promise<CustomerData> {
    if (!this.useFileStorage) {
      return this.inMemoryCustomers
    }

    try {
      const data = await fs.readFile(this.customerFile, 'utf-8')
      return JSON.parse(data)
    } catch {
      return {}
    }
  }

  /**
   * Save customer data to storage
   */
  private async saveCustomerData(data: CustomerData): Promise<void> {
    if (!this.useFileStorage) {
      this.inMemoryCustomers = { ...data }
      return
    }

    try {
      await fs.writeFile(this.customerFile, JSON.stringify(data, null, 2))
    } catch (error) {
      this.log('⚠️  Failed to save customer data:', error)
    }
  }

  /**
   * Check if it's a new day (for resetting daily counters)
   */
  private isNewDay(lastReset: string, now: Date): boolean {
    const lastResetDate = new Date(lastReset)
    return lastResetDate.toDateString() !== now.toDateString()
  }

  /**
   * Acquire file lock to prevent race conditions
   */
  private async withFileLock<T>(fn: () => Promise<T>): Promise<T> {
    // Wait for any existing operation to complete
    await this.fileLock

    // Create a new promise for this operation
    let release: () => void
    this.fileLock = new Promise(resolve => {
      release = resolve
    })

    try {
      return await fn()
    } finally {
      release!()
    }
  }

  /**
   * Check usage limits for a customer
   */
  async checkLimits(params: {
    customerRef: string
    productRef: string
  }): Promise<{
    withinLimits: boolean
    remaining: number
    plan: string
    meterName?: string
    checkoutSessionId?: string
    checkoutUrl?: string
  }> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, this.delays.checkLimits))

    this.log(`📡 Stub Request: POST /v1/sdk/limits`)
    this.log(`   Customer: ${params.customerRef}, Product: ${params.productRef}`)

    // Use file lock for thread-safe file operations
    return await this.withFileLock(async () => {
      // Load customer data from persistent storage
      const customerData = await this.loadCustomerData()
      const customer = customerData[params.customerRef]

      // Check if customer has pro or premium plan (unlimited access)
      if (customer?.plan === 'pro' || customer?.plan === 'premium') {
        this.log(`✅ Customer has ${customer.plan} plan with unlimited access`)
        return {
          withinLimits: true,
          remaining: 999999,
          plan: customer.plan,
          meterName: 'api_requests',
        }
      }

      // Check if customer has paid access (credits > 0)
      if (customer && customer.credits > 0) {
        this.log(`✅ Customer has paid access with ${customer.credits} credits`)
        return {
          withinLimits: true,
          remaining: customer.credits,
          plan: customer.plan || 'paid',
          meterName: 'api_requests',
        }
      }

      // No paid access, check free tier
      const freeTierData = await this.loadFreeTierData()
      const key = `${params.customerRef}_${params.productRef}`
      const now = new Date()
      const usage = freeTierData[key]

      // Reset daily counter if it's a new day or first time
      if (!usage || this.isNewDay(usage.lastReset, now)) {
        const newUsage = { count: 1, lastReset: now.toISOString() }
        freeTierData[key] = newUsage
        await this.saveFreeTierData(freeTierData)

        this.log(
          `🆕 Reset daily counter for ${params.customerRef}, remaining: ${this.freeTierLimit - 1}`,
        )
        return {
          withinLimits: true,
          remaining: this.freeTierLimit - 1,
          plan: 'free',
          meterName: 'api_requests',
        }
      }

      const withinLimits = usage.count < this.freeTierLimit

      // Increment counter if within free tier
      if (withinLimits) {
        usage.count += 1
        await this.saveFreeTierData(freeTierData)
        this.log(`📊 Usage incremented to ${usage.count}/${this.freeTierLimit}`)
      } else {
        this.log(`🚫 Free tier limit exceeded: ${usage.count}/${this.freeTierLimit}`)
      }

      const remaining = Math.max(0, this.freeTierLimit - usage.count)

      const result = {
        withinLimits,
        remaining,
        plan: 'free',
        meterName: 'api_requests' as string | undefined,
      }

      // Add checkout URL if limits exceeded
      if (!withinLimits) {
        return {
          ...result,
          checkoutUrl: `https://checkout.solvapay.com/demo?customer=${params.customerRef}&product=${params.productRef}`,
        }
      }

      return result
    }) // end of withFileLock
  }

  /**
   * Track usage for analytics
   */
  async trackUsage(params: {
    customerRef: string
    actionType?: 'transaction' | 'api_call' | 'hour' | 'email' | 'storage' | 'custom'
    units?: number
    outcome?: 'success' | 'paywall' | 'fail'
    productRef?: string
    purchaseRef?: string
    description?: string
    metadata?: Record<string, unknown>
    duration?: number
    timestamp?: string
    idempotencyKey?: string
  }): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.delays.trackUsage))

    this.log(`📡 Stub Request: POST /v1/sdk/usages`)
    this.log(
      `   Action: ${params.metadata?.action || 'api_requests'}, Units: ${params.units || 1}, Customer: ${params.customerRef}`,
    )
  }

  /**
   * Create a checkout session (for testing)
   */
  async createCheckoutSession(params: {
    customerRef: string
    productRef: string
    planRef?: string
  }): Promise<{
    id: string
    sessionId: string
    amount: number
    currency: string
    status: string
    checkoutUrl: string
  }> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    const id = `cs_${Math.random().toString(36).slice(2, 15)}`
    const sessionId = `sess_${Math.random().toString(36).slice(2, 15)}`

    const queryParams = new URLSearchParams({
      customer: params.customerRef,
      product: params.productRef,
      sessionId: sessionId,
    })

    if (params.planRef) {
      queryParams.set('plan', params.planRef)
    }

    const checkoutUrl = `https://checkout.solvapay.com/demo?${queryParams.toString()}`

    this.log(`💳 Created checkout session for ${params.customerRef}: ${checkoutUrl}`)

    return {
      id,
      sessionId,
      amount: 0,
      currency: 'USD',
      status: 'active',
      checkoutUrl,
    }
  }

  /**
   * Create a customer session for accessing customer-specific functionality
   */
  async createCustomerSession(params: { customerRef: string }): Promise<{
    sessionId: string
    customerUrl: string
  }> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    // Generate a mock session ID
    const sessionId = `customer_sess_${Math.random().toString(36).slice(2, 15)}`

    // Build customer session URL
    const customerUrl = `${this.baseUrl}/customer-session/${sessionId}`

    this.log(`🔐 Created customer session for ${params.customerRef}: ${sessionId}`)

    return {
      sessionId,
      customerUrl,
    }
  }

  /**
   * Create a topup payment intent (stub returns mock Stripe data)
   */
  async createTopupPaymentIntent(params: {
    customerRef: string
    amount: number
    currency: string
    description?: string
    idempotencyKey?: string
  }): Promise<{
    processorPaymentId: string
    clientSecret: string
    publishableKey: string
    accountId?: string
  }> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(`📡 Stub Request: POST /v1/sdk/payment-intents (topup)`)
    this.log(`   Customer: ${params.customerRef}, Amount: ${params.amount}, Currency: ${params.currency}`)

    const processorPaymentId = `pi_topup_${Math.random().toString(36).slice(2, 15)}`

    await this.addCredits(params.customerRef, params.amount)

    return {
      processorPaymentId,
      clientSecret: `${processorPaymentId}_secret_${Math.random().toString(36).slice(2, 15)}`,
      publishableKey: 'pk_test_stub_demo_key',
    }
  }

  /**
   * Create a plan-purchase payment intent (stub returns mock Stripe data).
   *
   * The returned `clientSecret` is deliberately unusable against Stripe — it
   * exists so `next build` and initial UI rendering succeed. Runtime
   * `confirmPayment` calls will fail unless the consumer swaps the stub for a
   * real `createSolvaPay({ apiKey })` or wires `STRIPE_TEST_PK` into a
   * bespoke variant.
   */
  async createPaymentIntent(params: {
    productRef: string
    planRef: string
    customerRef: string
    idempotencyKey?: string
  }): Promise<CreatePaymentIntentResult> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(`📡 Stub Request: POST /v1/sdk/payment-intents`)
    this.log(
      `   Customer: ${params.customerRef}, Product: ${params.productRef}, Plan: ${params.planRef}`,
    )

    const processorPaymentId = `pi_stub_${Math.random().toString(36).slice(2, 15)}`

    return {
      processorPaymentId,
      clientSecret: `${processorPaymentId}_secret_${Math.random().toString(36).slice(2, 15)}`,
      publishableKey: 'pk_test_stub_demo_key',
    }
  }

  /**
   * Process a plan-purchase payment intent (stub returns a synthetic purchase).
   *
   * The stub does not verify the payment intent against Stripe. It marks the
   * customer as holding the paid plan and returns a well-formed
   * `ProcessPaymentResult` suitable for driving the UI.
   */
  async processPaymentIntent(params: {
    paymentIntentId: string
    productRef: string
    customerRef: string
    planRef?: string
  }): Promise<ProcessPaymentResult> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(
      `📡 Stub Request: POST /v1/sdk/payment-intents/${params.paymentIntentId}/process`,
    )

    const customerData = await this.loadCustomerData()
    if (!customerData[params.customerRef]) {
      customerData[params.customerRef] = { credits: 0 }
    }

    const isProPlan = params.planRef === 'plan_pro'
    if (isProPlan) {
      customerData[params.customerRef].plan = 'pro'
      await this.saveCustomerData(customerData)
    }

    const now = new Date()
    const purchase: NonNullable<ProcessPaymentResult['purchase']> = {
      reference: `pur_stub_${Math.random().toString(36).slice(2, 10)}`,
      productName: 'Demo Product',
      productRef: params.productRef,
      status: 'active',
      startDate: now.toISOString(),
      amount: isProPlan ? 2900 : 0,
      currency: 'USD',
      planRef: params.planRef,
    }

    return {
      type: 'recurring',
      purchase,
      status: 'completed',
    }
  }

  /**
   * Activate a plan for a customer (stub).
   *
   * - `plan_free` → always `activated`.
   * - any other plan + balance `0` → `topup_required` (paid plans still need
   *   a payment intent; this mirrors the backend's activation semantics for
   *   usage-based plans).
   * - any other plan + balance `> 0` → `activated`.
   */
  async activatePlan(params: {
    customerRef: string
    productRef: string
    planRef: string
  }): Promise<ActivatePlanResult> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(`📡 Stub Request: POST /v1/sdk/activate`)
    this.log(
      `   Customer: ${params.customerRef}, Product: ${params.productRef}, Plan: ${params.planRef}`,
    )

    if (params.planRef === 'plan_free') {
      const customerData = await this.loadCustomerData()
      if (!customerData[params.customerRef]) {
        customerData[params.customerRef] = { credits: 0 }
      }
      customerData[params.customerRef].plan = 'free'
      await this.saveCustomerData(customerData)

      return {
        status: 'activated',
        purchaseRef: `pur_stub_${Math.random().toString(36).slice(2, 10)}`,
      }
    }

    const credits = await this.getCredits(params.customerRef)
    if (credits <= 0) {
      return {
        status: 'topup_required',
        creditBalance: 0,
        creditsPerUnit: 1,
        currency: 'USD',
      }
    }

    return {
      status: 'activated',
      purchaseRef: `pur_stub_${Math.random().toString(36).slice(2, 10)}`,
      creditBalance: credits,
      creditsPerUnit: 1,
      currency: 'USD',
    }
  }

  /**
   * Get customer credit balance (stub reads from in-memory/file storage).
   */
  async getCustomerBalance(params: {
    customerRef: string
  }): Promise<CustomerBalanceResult> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(`📡 Stub Request: GET /v1/sdk/customers/${params.customerRef}/credits`)

    const credits = await this.getCredits(params.customerRef)

    return {
      customerRef: params.customerRef,
      credits,
      displayCurrency: 'USD',
      creditsPerMinorUnit: 100,
      displayExchangeRate: 1,
    }
  }

  /**
   * Get a product by reference (stub returns a fixed demo product).
   */
  async getProduct(productRef: string): Promise<ProductResponse> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(`📡 Stub Request: GET /v1/sdk/products/${productRef}`)

    const now = new Date().toISOString()
    return {
      reference: productRef,
      name: 'Demo Product',
      description: 'A stubbed product for local development and example builds.',
      status: 'active',
      balance: 0,
      totalTransactions: 0,
      isMcpPay: false,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Get merchant identity (stub returns demo data).
   */
  async getMerchant(): Promise<MerchantResponse> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(`📡 Stub Request: GET /v1/sdk/merchant`)

    return {
      displayName: 'Demo Merchant',
      legalName: 'Demo Merchant Ltd',
      supportEmail: 'support@example.com',
      termsUrl: 'https://example.com/terms',
      privacyUrl: 'https://example.com/privacy',
      defaultCurrency: 'USD',
    }
  }

  /**
   * Create a new customer
   */
  async createCustomer(params: {
    email: string
    name?: string
    externalRef?: string
  }): Promise<{ customerRef: string }> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(`📡 Stub Request: POST /v1/sdk/customers`)
    this.log(
      `   Email: ${params.email}, Name: ${params.name || 'N/A'}, ExternalRef: ${params.externalRef || 'N/A'}`,
    )

    const customerData = await this.loadCustomerData()
    const normalizedEmail = params.email.trim().toLowerCase()

    // If externalRef is provided, check for existing customer by externalRef first
    if (params.externalRef) {
      for (const [ref, customer] of Object.entries(customerData)) {
        if (customer.externalRef === params.externalRef) {
          this.log(`🔍 Found existing customer by externalRef: ${params.externalRef} -> ${ref}`)
          return { customerRef: ref }
        }
      }
    }

    // Look for existing customer by email
    for (const [ref, customer] of Object.entries(customerData)) {
      if (customer.email === normalizedEmail) {
        this.log(`🔍 Found existing customer for ${normalizedEmail} -> ${ref}`)
        return { customerRef: ref }
      }
    }

    // Check if the email looks like an auto-created one (e.g., cus_GWXFK3C4@auto-created.local)
    // and if so, use that as the customer reference directly (for persistence across restarts)
    if (normalizedEmail.endsWith('@auto-created.local')) {
      const potentialRef = normalizedEmail.replace('@auto-created.local', '')

      // Check if customer already exists with this exact ref
      if (customerData[potentialRef]) {
        this.log(`🔍 Found existing customer by ref: ${potentialRef}`)
        return { customerRef: potentialRef }
      }

      // Create new customer with the exact ref from the email (no suffix)
      // This ensures the customer ref stays consistent across requests
      customerData[potentialRef] = {
        credits: 0, // New customers start with 0 credits (free tier only)
        email: normalizedEmail,
        name: params.name,
        externalRef: params.externalRef,
      }

      await this.saveCustomerData(customerData)
      this.log(`✅ Created new customer with stable ref: ${potentialRef}`)

      return { customerRef: potentialRef }
    }

    // For real emails (not auto-created), create with a suffix
    const suffix = Math.random().toString(36).slice(2, 8)
    const ref = `cust_${normalizedEmail.replace(/[^a-z0-9]/g, '_')}_${suffix}`

    customerData[ref] = {
      credits: 0, // New customers start with 0 credits (free tier only)
      email: normalizedEmail,
      name: params.name,
      externalRef: params.externalRef,
    }

    await this.saveCustomerData(customerData)
    this.log(`✅ Created new customer for ${normalizedEmail} -> ${ref}`)

    return { customerRef: ref }
  }

  /**
   * Get customer details
   */
  async getCustomer(params: {
    customerRef?: string
    externalRef?: string
  }): Promise<CustomerResponseMapped> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    if (params.externalRef) {
      return this.getCustomerByExternalRef({ externalRef: params.externalRef })
    }

    if (!params.customerRef) {
      throw new Error('Either customerRef or externalRef must be provided')
    }

    this.log(`📡 Stub Request: GET /v1/sdk/customers/${params.customerRef}`)

    const customerData = await this.loadCustomerData()
    const customer = customerData[params.customerRef]

    if (!customer) {
      this.log(`❌ Customer not found: ${params.customerRef}`)
      throw new Error(`Customer not found: ${params.customerRef}`)
    }

    // Return plan from customer data, or determine based on credits
    const plan = customer.plan || (customer.credits > 0 ? 'paid' : 'free')

    this.log(`👤 Retrieved customer: ${params.customerRef} (${plan})`)

    return {
      customerRef: params.customerRef,
      email: customer.email,
      name: customer.name,
      externalRef: customer.externalRef,
      plan,
      purchases: [], // Stub doesn't track purchases yet
    }
  }

  /**
   * Get customer by external reference
   */
  async getCustomerByExternalRef(params: { externalRef: string }): Promise<CustomerResponseMapped> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))

    this.log(`📡 Stub Request: GET /v1/sdk/customers?externalRef=${params.externalRef}`)

    const customerData = await this.loadCustomerData()

    // Find customer by externalRef
    for (const [ref, customer] of Object.entries(customerData)) {
      if (customer.externalRef === params.externalRef) {
        const plan = customer.plan || (customer.credits > 0 ? 'paid' : 'free')

        this.log(`✅ Found customer by externalRef: ${params.externalRef} -> ${ref} (${plan})`)

        return {
          customerRef: ref,
          email: customer.email,
          name: customer.name,
          externalRef: params.externalRef,
          plan,
          purchases: [], // Stub doesn't track purchases yet
        }
      }
    }

    this.log(`❌ Customer not found by externalRef: ${params.externalRef}`)
    throw new Error(`Customer not found by externalRef: ${params.externalRef}`)
  }

  /**
   * Helper method: Add credits to a customer (for testing)
   */
  async addCredits(customerRef: string, credits: number): Promise<void> {
    const customerData = await this.loadCustomerData()
    if (!customerData[customerRef]) {
      customerData[customerRef] = { credits: 0 }
    }
    customerData[customerRef].credits += credits
    await this.saveCustomerData(customerData)
    this.log(
      `💰 Added ${credits} credits to ${customerRef}, total: ${customerData[customerRef].credits}`,
    )
  }

  /**
   * Helper method: Get customer credits (for testing)
   */
  async getCredits(customerRef: string): Promise<number> {
    const customerData = await this.loadCustomerData()
    return customerData[customerRef]?.credits || 0
  }

  /**
   * Helper method: Reset usage for a customer (for testing)
   */
  async resetUsage(customerRef?: string): Promise<void> {
    if (customerRef) {
      const freeTierData = await this.loadFreeTierData()
      const keysToDelete = Object.keys(freeTierData).filter(key =>
        key.startsWith(`${customerRef}_`),
      )
      keysToDelete.forEach(key => delete freeTierData[key])
      await this.saveFreeTierData(freeTierData)
      this.log(`🔄 Reset usage for ${customerRef}`)
    } else {
      // Reset all usage
      await this.saveFreeTierData({})
      this.log(`🔄 Reset all usage data`)
    }
  }

  /**
   * Helper method: Set customer plan (for testing)
   */
  async setPlan(customerRef: string, plan: 'free' | 'pro' | 'premium'): Promise<void> {
    const customerData = await this.loadCustomerData()
    if (!customerData[customerRef]) {
      customerData[customerRef] = { credits: 0 }
    }
    customerData[customerRef].plan = plan
    await this.saveCustomerData(customerData)
    this.log(`📋 Set plan for ${customerRef} to ${plan}`)
  }

  /**
   * List plans for a product (product-scoped)
   */
  async listPlans(productRef: string): Promise<ListPlansResponse> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))
    this.log(`📡 Stub Request: GET /v1/sdk/products/${productRef}/plans`)

    const now = new Date().toISOString()

    return [
      {
        type: 'recurring',
        reference: 'plan_free',
        price: 0,
        currency: 'USD',
        currencySymbol: '$',
        billingCycle: 'monthly',
        requiresPayment: false,
        isActive: true,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        freeUnits: this.freeTierLimit,
        limit: this.freeTierLimit,
      },
      {
        type: 'recurring',
        reference: 'plan_pro',
        price: 29,
        currency: 'USD',
        currencySymbol: '$',
        billingCycle: 'monthly',
        requiresPayment: true,
        isActive: true,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        limit: 0,
      },
    ]
  }

  /**
   * Create a plan under a product (product-scoped)
   */
  async createPlan(params: {
    productRef: string
    type?: string
    price?: number
    [key: string]: unknown
  }): Promise<ListPlansResponse[number]> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))
    this.log(`📡 Stub Request: POST /v1/sdk/products/${params.productRef}/plans`)

    const now = new Date().toISOString()
    const reference = `plan_${Math.random().toString(36).slice(2, 10)}`
    return {
      type: (params.type as ListPlansResponse[number]['type']) || 'recurring',
      reference,
      price: params.price ?? 0,
      currency: (params.currency as string) || 'USD',
      requiresPayment: (params.price ?? 0) > 0,
      isActive: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Update a plan under a product (product-scoped)
   */
  async updatePlan(
    productRef: string,
    planRef: string,
    params: Record<string, unknown>,
  ): Promise<ListPlansResponse[number]> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))
    this.log(`📡 Stub Request: PUT /v1/sdk/products/${productRef}/plans/${planRef}`)
    const now = new Date().toISOString()
    return {
      type: (params.type as ListPlansResponse[number]['type']) || 'recurring',
      reference: planRef,
      price: (params.price as number) ?? 0,
      currency: (params.currency as string) || 'USD',
      requiresPayment: ((params.price as number) ?? 0) > 0,
      isActive: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Delete a plan from a product (product-scoped)
   */
  async deletePlan(productRef: string, planRef: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))
    this.log(`📡 Stub Request: DELETE /v1/sdk/products/${productRef}/plans/${planRef}`)
  }

  /**
   * Clone a product
   */
  async cloneProduct(
    productRef: string,
    overrides?: { name?: string },
  ): Promise<{ reference: string; name: string }> {
    await new Promise(resolve => setTimeout(resolve, this.delays.customer))
    this.log(`📡 Stub Request: POST /v1/sdk/products/${productRef}/clone`)

    const reference = `prd_${Math.random().toString(36).slice(2, 10)}`
    const name = overrides?.name || `Clone of ${productRef}`
    return { reference, name }
  }

  /**
   * Get checkout URL for a customer
   */
  getCheckoutUrl(customerRef: string): string {
    return `${this.baseUrl}/checkout?plan=pro&customer_ref=${encodeURIComponent(customerRef)}&return_url=${encodeURIComponent(this.baseUrl)}`
  }

  /**
   * Sign out a user by revoking their access token
   */
  async signOut(accessToken: string): Promise<{ success: boolean; message: string }> {
    try {
      const formData = new FormData()
      formData.append('token', accessToken)
      formData.append('token_type_hint', 'access_token')

      const response = await fetch(`${this.baseUrl}/v1/customer/auth/revoke`, {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        this.log(`🔓 Access token revoked successfully`)
        return {
          success: data.revoked,
          message: data.message || 'Sign out successful',
        }
      } else {
        const errorData = await response.json()
        this.log(`⚠️  Failed to revoke access token: ${errorData.error_description}`)
        return {
          success: false,
          message: errorData.error_description || 'Sign out failed',
        }
      }
    } catch (error) {
      this.log(`❌ Sign out error: ${error}`)
      return {
        success: false,
        message: `Sign out error: ${error}`,
      }
    }
  }

  /**
   * Sign out a user by revoking their refresh token
   */
  async signOutRefreshToken(refreshToken: string): Promise<{ success: boolean; message: string }> {
    try {
      const formData = new FormData()
      formData.append('token', refreshToken)
      formData.append('token_type_hint', 'refresh_token')

      const response = await fetch(`${this.baseUrl}/v1/customer/auth/revoke`, {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        this.log(`🔓 Refresh token revoked successfully`)
        return {
          success: data.revoked,
          message: data.message || 'Refresh token revoked successfully',
        }
      } else {
        const errorData = await response.json()
        this.log(`⚠️  Failed to revoke refresh token: ${errorData.error_description}`)
        return {
          success: false,
          message: errorData.error_description || 'Refresh token revocation failed',
        }
      }
    } catch (error) {
      this.log(`❌ Refresh token revocation error: ${error}`)
      return {
        success: false,
        message: `Refresh token revocation error: ${error}`,
      }
    }
  }
}

/**
 * Create a stub SolvaPay client for testing and development
 *
 * @example
 * ```typescript
 * // Simple in-memory client
 * const client = createStubClient();
 *
 * // With file persistence
 * const client = createStubClient({ useFileStorage: true });
 *
 * // With custom limits
 * const client = createStubClient({ freeTierLimit: 10 });
 * ```
 */
export function createStubClient(options?: StubClientOptions): StubSolvaPayClient {
  return new StubSolvaPayClient(options)
}
