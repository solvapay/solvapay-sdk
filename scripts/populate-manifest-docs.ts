/**
 * Historical one-shot backfill (step 18T). Prefer OpenAPI description fallback
 * + `pnpm gen:scaffold` for new ops; keep this for replaying curated prose.
 *
 * Inject `docs:` blocks into sdk-contract.yaml for every catalogued entry point.
 * Idempotent: skips entries that already have `docs:`.
 *
 * Usage: pnpm exec tsx scripts/populate-manifest-docs.ts
 */

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stringify } from 'yaml'
import { entryBounds } from './lib/manifest-edit.js'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST_PATH = path.join(REPO_ROOT, 'contract/manifest/sdk-contract.yaml')

type DocsInput = {
  summary: string
  params?: Record<string, string>
  returns?: string
}

const OPERATION_DOCS: Record<string, DocsInput> = {
  checkLimits: {
    summary: "Check remaining usage/spend limits for a customer against a product's plan.",
    params: {
      params: 'Limits request including customer and product refs.',
    },
    returns: 'Current remaining limits, optionally including plan details.',
  },
  trackUsage: {
    summary: 'Record a single usage event against a meter for billing.',
    params: { params: 'Usage event payload (customer, meter, and amount).' },
    returns: 'The recorded usage event response.',
  },
  trackUsageBulk: {
    summary: 'Record multiple usage events in one request.',
    params: { params: 'Bulk usage payload with one or more events.' },
    returns: 'Bulk usage recording response.',
  },
  createCustomer: {
    summary: 'Create a customer in SolvaPay for the current merchant.',
    params: { params: 'Customer creation fields (email, external refs, metadata).' },
    returns: 'The created customer projection.',
  },
  updateCustomer: {
    summary: 'Update an existing customer by reference.',
    params: {
      customerRef: 'Customer reference to update.',
      params: 'Fields to patch on the customer.',
    },
    returns: 'The updated customer projection.',
  },
  getCustomer: {
    summary: 'Fetch a customer by reference.',
    params: { params: 'Lookup options including the customer reference.' },
    returns: 'The customer projection.',
  },
  assignCredits: {
    summary: 'Grant credits to a customer balance.',
    params: { params: 'Credit grant request (customer, amount, and reason).' },
    returns: 'Credit assignment response.',
  },
  getMerchant: {
    summary: 'Fetch the authenticated merchant profile.',
    returns: 'Merchant profile projection.',
  },
  getPlatformConfig: {
    summary: 'Fetch platform configuration for the current merchant.',
    returns: 'Platform configuration projection.',
  },
  getProduct: {
    summary: 'Fetch a product by reference.',
    params: { productRef: 'Product reference to fetch.' },
    returns: 'Product projection.',
  },
  listProducts: {
    summary: 'List products for the current merchant.',
    returns: 'Product list projection.',
  },
  createProduct: {
    summary: 'Create a product for the current merchant.',
    params: { params: 'Product creation fields.' },
    returns: 'The created product projection.',
  },
  bootstrapMcpProduct: {
    summary: 'Bootstrap an MCP product with default plans and tooling.',
    params: { params: 'MCP bootstrap request payload.' },
    returns: 'Bootstrap result including product and plan refs.',
  },
  configureMcpPlans: {
    summary: 'Configure MCP plans for an existing product.',
    params: {
      productRef: 'Product whose MCP plans are configured.',
      params: 'MCP plan configuration payload.',
    },
    returns: 'Configured MCP plans response.',
  },
  updateProduct: {
    summary: 'Update an existing product by reference.',
    params: {
      productRef: 'Product reference to update.',
      params: 'Fields to patch on the product.',
    },
    returns: 'The updated product projection.',
  },
  deleteProduct: {
    summary: 'Delete a product by reference.',
    params: { productRef: 'Product reference to delete.' },
  },
  cloneProduct: {
    summary: 'Clone a product, optionally applying field overrides.',
    params: {
      productRef: 'Source product reference to clone.',
      overrides: 'Optional field overrides applied to the clone.',
    },
    returns: 'The cloned product projection.',
  },
  listPlans: {
    summary: 'List plans for a product.',
    params: { productRef: 'Product whose plans are listed.' },
    returns: 'Plan list projection.',
  },
  createPlan: {
    summary: 'Create a plan under a product.',
    params: { params: 'Plan creation fields including product ref.' },
    returns: 'The created plan projection.',
  },
  updatePlan: {
    summary: 'Update an existing plan by product and plan references.',
    params: {
      productRef: 'Product that owns the plan.',
      planRef: 'Plan reference to update.',
      params: 'Fields to patch on the plan.',
    },
    returns: 'The updated plan projection.',
  },
  deletePlan: {
    summary: 'Delete a plan by product and plan references.',
    params: {
      productRef: 'Product that owns the plan.',
      planRef: 'Plan reference to delete.',
    },
  },
  createPaymentIntent: {
    summary: 'Create a payment intent for a purchase or activation flow.',
    params: { params: 'Payment intent creation fields.' },
    returns: 'Created payment intent projection.',
  },
  createTopupPaymentIntent: {
    summary: 'Create a payment intent to top up a customer balance.',
    params: { params: 'Top-up payment intent fields.' },
    returns: 'Created top-up payment intent projection.',
  },
  cancelPurchase: {
    summary: 'Cancel an active purchase for a customer.',
    params: { params: 'Cancel request identifying the purchase.' },
    returns: 'Updated purchase info after cancellation.',
  },
  reactivatePurchase: {
    summary: 'Reactivate a previously cancelled purchase.',
    params: { params: 'Reactivate request identifying the purchase.' },
    returns: 'Updated purchase info after reactivation.',
  },
  processPaymentIntent: {
    summary: 'Process a completed payment intent into a purchase or top-up outcome.',
    params: { params: 'Process request identifying the payment intent.' },
    returns: 'Normalized process-payment result (purchase, top-up, or error branch).',
  },
  attachBusinessDetails: {
    summary: 'Attach or update business details used for tax and invoicing.',
    params: { params: 'Business details payload.' },
    returns: 'Attached business details result.',
  },
  getUserInfo: {
    summary: 'Fetch end-user info for a customer session.',
    params: { params: 'User-info request options.' },
    returns: 'User info projection.',
  },
  getCustomerBalance: {
    summary: 'Fetch a customer credit balance projection for display.',
    params: { params: 'Balance request identifying the customer.' },
    returns: 'Customer balance display projection.',
  },
  createCheckoutSession: {
    summary: 'Create a hosted checkout session for a customer and product.',
    params: { params: 'Checkout session creation fields.' },
    returns: 'Created checkout session projection.',
  },
  createCustomerSession: {
    summary: 'Create a customer portal/session for self-serve account actions.',
    params: { params: 'Customer session creation fields.' },
    returns: 'Created customer session projection.',
  },
  activatePlan: {
    summary: 'Activate a plan for a customer (purchase or entitlement grant).',
    params: { params: 'Plan activation request fields.' },
    returns: 'Activation result projection.',
  },
  getPaymentMethod: {
    summary: 'Fetch the default payment method for a customer.',
    params: { params: 'Payment-method lookup options.' },
    returns: 'Payment method info, when present.',
  },
  getAutoRecharge: {
    summary: 'Fetch auto-recharge configuration for a customer.',
    params: { params: 'Auto-recharge lookup options.' },
    returns: 'Auto-recharge configuration projection.',
  },
  saveAutoRecharge: {
    summary: 'Create or update auto-recharge configuration for a customer.',
    params: { params: 'Auto-recharge settings to persist.' },
    returns: 'Saved auto-recharge configuration.',
  },
  disableAutoRecharge: {
    summary: 'Disable auto-recharge for a customer.',
    params: { params: 'Disable request identifying the customer.' },
    returns: 'Updated auto-recharge status after disable.',
  },
}

const TOP_LEVEL_DOCS: Record<string, DocsInput> = {
  verifyWebhook: {
    summary: 'Verify a SolvaPay webhook signature and parse the event payload.',
    params: {
      options: 'Webhook body, signature header, and signing secret.',
    },
    returns: 'Parsed webhook event when verification succeeds.',
  },
  withRetry: {
    summary: 'Retry an async callable with the frozen default backoff policy.',
    params: {
      fn: '() => Promise<T> — callable stand-in',
      options: 'Optional retry overrides.',
    },
    returns: "The callable's resolved value.",
  },
  buildPaywallGate: {
    summary: 'Build a structured paywall gate from classification inputs.',
    params: { input: 'Paywall gate construction input.' },
    returns: 'Paywall gate payload for client or MCP surfaces.',
  },
  buildGateMessage: {
    summary: 'Build the end-user paywall gate message copy.',
    params: { input: 'Inputs used to render the gate message.' },
    returns: 'Localized or frozen gate message string.',
  },
  buildNudgeMessage: {
    summary: 'Build the end-user soft-nudge message copy.',
    params: { input: 'Inputs used to render the nudge message.' },
    returns: 'Localized or frozen nudge message string.',
  },
  classifyPaywallState: {
    summary: 'Classify the current paywall state for a customer and product.',
    params: { input: 'Limits and purchase signals used for classification.' },
    returns: 'Tagged paywall state kind and details.',
  },
  paywallErrorToClientPayload: {
    summary: 'Project a PaywallError into the stable client 402 JSON payload.',
    params: { error: 'PaywallError (or gate) to project.' },
    returns: 'Client-facing paywall error payload.',
  },
  SolvaPayError: {
    summary: 'Construct a SolvaPay API/transport error with optional status and code.',
    params: {
      message: 'Human-readable error message.',
      init: 'Optional status, code, and details.',
    },
  },
  PaywallError: {
    summary: 'Construct a structured payment-required / activation error.',
    params: {
      message: 'Human-readable paywall message.',
      structuredContent: 'Gate payload embedded on the error.',
    },
  },
}

const CORE_HELPER_DOCS: Record<string, DocsInput> = {
  validateBusinessDetails: {
    summary: 'Validate business-details fields before attach/update.',
  },
  deriveTaxIdType: {
    summary: 'Derive the tax-id type for a business country.',
  },
  resolveTaxBehavior: {
    summary: 'Resolve inclusive vs exclusive tax behavior for a currency.',
  },
  getTaxIdExample: {
    summary: 'Return an example tax-id string for a business country.',
  },
  getTaxIdFieldLabel: {
    summary: 'Return the tax-id field label for a business country.',
  },
  getTaxIdHelperText: {
    summary: 'Return helper text for the tax-id field for a business country.',
  },
  BUSINESS_COUNTRY_DISPLAY_NAMES: {
    summary: 'Map of supported business-country codes to display names.',
  },
  BUSINESS_COUNTRY_OPTIONS: {
    summary: 'Ordered select options for supported business countries.',
  },
  COUNTRY_TO_TAX_ID_TYPE: {
    summary: 'Map of business-country codes to tax-id type identifiers.',
  },
  SUPPORTED_BUSINESS_COUNTRIES: {
    summary: 'List of supported business-country codes.',
  },
  TAX_BEHAVIORS: {
    summary: 'Supported tax-behavior identifiers.',
  },
  TAX_EXCLUSIVE_CURRENCIES: {
    summary: 'Currencies that default to tax-exclusive behavior.',
  },
  TAX_ID_EXAMPLE_BY_COUNTRY: {
    summary: 'Map of business-country codes to example tax-id strings.',
  },
  TAX_ID_TYPES: {
    summary: 'Supported tax-id type identifiers.',
  },
  creditsToDisplayMinorUnits: {
    summary: 'Convert credit units into currency minor units for display.',
  },
  isZeroDecimalCurrency: {
    summary: 'Whether a currency uses zero decimal places (e.g. JPY).',
  },
  minorUnitsPerMajor: {
    summary: 'Return the number of minor units per major unit for a currency.',
  },
  resolveSellerIdentityDisplay: {
    summary: 'Resolve seller identity fields for receipt/invoice display.',
  },
  getSellerTaxIdentifierDisplayLabel: {
    summary: 'Return the display label for a seller tax-identifier type.',
  },
  SELLER_TAX_IDENTIFIER_DISPLAY_LABEL_BY_TYPE: {
    summary: 'Map of seller tax-identifier types to display labels.',
  },
}

const FACADE_DOCS: Record<string, DocsInput> = {
  createSolvaPay: {
    summary: 'Create a configured SolvaPay client / high-level facade.',
    params: { config: 'API key and optional runtime overrides.' },
    returns: 'Configured SolvaPay facade instance.',
  },
  createSolvaPayClient: {
    summary: 'Create a low-level SolvaPayClient without facade helpers.',
    params: { opts: 'Client construction options (API key, base URL).' },
    returns: 'Configured SolvaPayClient instance.',
  },
  payable: {
    summary: 'Mark a handler as payable and bind product/meter options.',
    params: { options: 'Payable options (product, meter, and tracking).' },
    returns: 'Payable wrapper used with protect / MCP adapters.',
  },
  protect: {
    summary: 'Wrap a handler with paywall enforcement for a payable surface.',
    params: { options: 'Protection options (customer resolution and product).' },
    returns: 'Protected handler that gates on limits before running.',
  },
  gate: {
    summary: 'Evaluate the paywall for a customer + product; returns an allow or paywall decision.',
    params: { options: 'Gate options (customer, product, and optional meter).' },
    returns: 'Allow decision or structured paywall gate.',
  },
}

function docsYaml(docs: DocsInput, indent: number): string {
  const pad = ' '.repeat(indent)
  const rendered = stringify(
    { docs },
    {
      lineWidth: 0,
      defaultKeyType: 'PLAIN',
      defaultStringType: 'QUOTE_DOUBLE',
    },
  )
  return (
    rendered
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => `${pad}${line}`)
      .join('\n') + '\n'
  )
}

function insertBeforeSync(text: string, entryId: string, docs: DocsInput): string {
  const { start, end } = entryBounds(text, entryId)
  const full = text.slice(start, end)
  if (/^    docs:/m.test(full)) {
    return text
  }
  if (!/^    sync:/m.test(full)) {
    throw new Error(`No sync: block in ${entryId}`)
  }
  const insert = docsYaml(docs, 4)
  const withDocs = full.replace(/^    sync:/m, `${insert}    sync:`)
  return text.slice(0, start) + withDocs + text.slice(end)
}

function applySection(
  text: string,
  docsById: Record<string, DocsInput>,
  sectionLabel: string,
): string {
  let out = text
  for (const [id, docs] of Object.entries(docsById)) {
    const before = out
    out = insertBeforeSync(out, id, docs)
    if (out === before) {
      console.log(`skip (already has docs): ${sectionLabel}.${id}`)
    } else {
      console.log(`inserted docs: ${sectionLabel}.${id}`)
    }
  }
  return out
}

function main(): void {
  let raw = readFileSync(MANIFEST_PATH, 'utf8')
  raw = applySection(raw, OPERATION_DOCS, 'operations')
  raw = applySection(raw, TOP_LEVEL_DOCS, 'topLevel')
  raw = applySection(raw, CORE_HELPER_DOCS, 'coreHelpers')
  raw = applySection(raw, FACADE_DOCS, 'facade')
  writeFileSync(MANIFEST_PATH, raw)
  console.log(`Wrote ${MANIFEST_PATH}`)
}

main()
