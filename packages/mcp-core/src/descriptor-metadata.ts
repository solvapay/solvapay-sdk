/**
 * Pure MCP descriptor metadata (Step 35).
 *
 * Name tables, view maps, icon projection, tool/prompt metadata, and
 * prompt user-message text. Handler closures, zod schemas, fs/crypto,
 * CSP, and bootstrap stay in `descriptors.ts`.
 */

import { MCP_TOOL_NAMES, type McpToolName } from './tool-names'
import { SOLVAPAY_MCP_VIEW_KINDS, TOOL_FOR_VIEW } from './types'
import type {
  SolvaPayMerchantBranding,
  SolvaPayMcpViewKind,
  SolvaPayPromptResult,
  SolvaPayToolAnnotations,
  SolvaPayToolIcon,
} from './types'

/** Frozen validation message for non-http(s) `publicBaseUrl`. */
export const PUBLIC_BASE_URL_ERROR =
  'buildSolvaPayDescriptors: publicBaseUrl must be an http(s) URL (Stripe confirmPayment rejects `ui://`).'

const UI_ONLY_PREFIX =
  'UI-only; agents should prefer `upgrade` / `manage_account` / `activate_plan`. '

const MODE_HINT =
  " By default renders the UI iframe with a one-line placeholder; pass `mode: 'text'` for a markdown-only summary on CLI / text-only hosts, or `mode: 'auto'` to include both."

const DEFAULT_VIEWS: SolvaPayMcpViewKind[] = [...SOLVAPAY_MCP_VIEW_KINDS]

/**
 * Project `SolvaPayMerchantBranding` into an `icons[]` array suitable
 * for MCP host chrome. Prefers square `iconUrl`; falls back to
 * landscape `logoUrl`. Returns `undefined` when neither asset is set.
 */
export function deriveIcons(
  branding: SolvaPayMerchantBranding | undefined,
): SolvaPayToolIcon[] | undefined {
  if (!branding) return undefined
  const assets: SolvaPayToolIcon[] = []
  if (branding.iconUrl) {
    assets.push({ src: branding.iconUrl, sizes: ['any', '512x512'] })
  } else if (branding.logoUrl) {
    assets.push({ src: branding.logoUrl })
  }
  return assets.length > 0 ? assets : undefined
}

/** Stamp universal `openWorldHint: true` onto per-tool hint flags. */
export function solvapayTool(
  hints: Omit<SolvaPayToolAnnotations, 'openWorldHint'>,
): SolvaPayToolAnnotations {
  return { openWorldHint: true, ...hints }
}

/** Per-view annotation map for intent tools — keep aligned with `TOOL_FOR_VIEW`. */
export const INTENT_TOOL_ANNOTATIONS: Record<
  keyof typeof TOOL_FOR_VIEW,
  SolvaPayToolAnnotations
> = {
  account: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
  topup: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
  checkout: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
}

/** Tool metadata without `inputSchema` / `handler` (pure registration surface). */
export type ToolDescriptorMetadata = {
  name: string
  title?: string
  description: string
  annotations: SolvaPayToolAnnotations
  meta: Record<string, unknown>
  icons?: SolvaPayToolIcon[]
}

/** Prompt metadata without `argsSchema` / `handler`. */
export type PromptDescriptorMetadata = {
  name: string
  title: string
  description: string
}

export type BuildToolDescriptorMetadataOptions = {
  resourceUri: string
  views?: SolvaPayMcpViewKind[]
  branding?: SolvaPayMerchantBranding
}

export type BuildPromptDescriptorMetadataOptions = {
  views?: SolvaPayMcpViewKind[]
}

/**
 * Validate `publicBaseUrl` is http(s). Returns the frozen error message
 * or `null` when valid.
 */
export function validatePublicBaseUrl(publicBaseUrl: string): string | null {
  if (!/^https?:\/\//i.test(publicBaseUrl)) {
    return PUBLIC_BASE_URL_ERROR
  }
  return null
}

/**
 * Ordered tool descriptor metadata (intent tools filtered by `views`,
 * then transport tools, then `activate_plan`).
 */
export function buildToolDescriptorMetadata(
  options: BuildToolDescriptorMetadataOptions,
): ToolDescriptorMetadata[] {
  const { resourceUri, views = DEFAULT_VIEWS, branding } = options
  const toolIcons = deriveIcons(branding)
  const enabledViews = new Set<SolvaPayMcpViewKind>(views)
  const toolMeta = { ui: { resourceUri } }
  const uiToolMeta = {
    ui: { resourceUri, visibility: ['app'] as const },
    audience: 'ui' as const,
    'openai/widgetAccessible': true as const,
  }

  const tools: ToolDescriptorMetadata[] = []
  const push = (descriptor: ToolDescriptorMetadata): void => {
    tools.push(toolIcons ? { ...descriptor, icons: toolIcons } : descriptor)
  }

  const pushIntent = (
    view: keyof typeof TOOL_FOR_VIEW,
    title: string,
    description: string,
  ): void => {
    if (!enabledViews.has(view)) return
    push({
      name: TOOL_FOR_VIEW[view],
      title,
      description,
      meta: toolMeta,
      annotations: INTENT_TOOL_ANNOTATIONS[view],
    })
  }

  pushIntent(
    'checkout',
    'Upgrade plan',
    'Start or change a paid plan for the current customer. On UI hosts this opens the embedded checkout; on text hosts returns a markdown summary with a checkout URL. This tool only returns a read-only snapshot or opens the UI — actual charges happen later in the embedded checkout after the customer confirms. Also available: manage_account (current plan + cancel/reactivate), activate_plan (pick or activate a specific plan), topup (add credits).' +
      MODE_HINT,
  )
  pushIntent(
    'account',
    'Manage account',
    "Show or manage the current customer's SolvaPay account: plan, balance, usage, payment method, cancel/reactivate auto-renewal. On UI hosts this opens the embedded account view; on text hosts returns a markdown summary. Also available: upgrade (start/change a paid plan), activate_plan (pick or activate), topup (add credits)." +
      MODE_HINT,
  )
  pushIntent(
    'topup',
    'Top up credits',
    'Add SolvaPay credits for the current customer. On UI hosts this opens the embedded top-up flow; on text hosts returns a markdown summary with a top-up URL. This tool only returns a read-only snapshot or opens the UI — credits are not charged until the customer confirms payment in the embedded flow. Also available: manage_account (current plan + balance + usage), upgrade (switch to a recurring plan).' +
      MODE_HINT,
  )

  push({
    name: MCP_TOOL_NAMES.createCheckoutSession,
    description:
      UI_ONLY_PREFIX +
      'Create a SolvaPay hosted checkout session and return its URL. The UI opens this URL in a new tab when Stripe Elements is blocked by the host sandbox.',
    meta: uiToolMeta,
    annotations: solvapayTool({}),
  })
  push({
    name: MCP_TOOL_NAMES.createPayment,
    description:
      UI_ONLY_PREFIX +
      'Create a Stripe payment intent for the authenticated customer to purchase a plan. Returns { clientSecret, publishableKey, accountId?, customerRef } for confirmation with Stripe Elements in the app UI.',
    meta: uiToolMeta,
    annotations: solvapayTool({}),
  })
  push({
    name: MCP_TOOL_NAMES.processPayment,
    description:
      UI_ONLY_PREFIX +
      'Process a Stripe payment intent after client-side confirmation and create the SolvaPay purchase. Call after confirmPayment resolves to short-circuit webhook latency.',
    meta: uiToolMeta,
    annotations: solvapayTool({ destructiveHint: true }),
  })
  push({
    name: MCP_TOOL_NAMES.createCustomerSession,
    description:
      UI_ONLY_PREFIX +
      'Create a SolvaPay hosted customer portal session and return its URL. Used to let a paid customer manage or cancel their purchase in a new tab.',
    meta: uiToolMeta,
    annotations: solvapayTool({ readOnlyHint: true, idempotentHint: true }),
  })
  push({
    name: MCP_TOOL_NAMES.createTopupPayment,
    description:
      UI_ONLY_PREFIX +
      'Create a Stripe payment intent for a credit top-up. Credits are recorded by the SolvaPay webhook after confirmation.',
    meta: uiToolMeta,
    annotations: solvapayTool({}),
  })
  push({
    name: MCP_TOOL_NAMES.attachBusinessDetails,
    description:
      UI_ONLY_PREFIX +
      'Attach business purchase details to a payment intent and retrieve the computed tax breakdown.',
    meta: uiToolMeta,
    annotations: solvapayTool({}),
  })
  push({
    name: MCP_TOOL_NAMES.cancelRenewal,
    description:
      UI_ONLY_PREFIX +
      'Cancel the auto-renewal on an active purchase. Backend keeps access until the current period ends.',
    meta: uiToolMeta,
    annotations: solvapayTool({ destructiveHint: true, idempotentHint: true }),
  })
  push({
    name: MCP_TOOL_NAMES.reactivateRenewal,
    description:
      UI_ONLY_PREFIX +
      "Undo a pending cancellation so auto-renewal resumes. Only valid while the purchase is still active and its end date hasn't passed.",
    meta: uiToolMeta,
    annotations: solvapayTool({ idempotentHint: true }),
  })
  push({
    name: MCP_TOOL_NAMES.activatePlan,
    title: 'Activate plan',
    description:
      'Activate a plan for the current customer. With a `planRef`: free plans activate immediately; usage-based plans activate when the balance covers the configured usage; paid plans return a markdown checkout link on text hosts or open the embedded checkout on UI hosts. Without a `planRef`: returns the available plans so the customer can pick — UI hosts render the embedded checkout picker, text hosts see a plans list. Also available: upgrade (direct to checkout), manage_account (current plan + usage), topup (add credits).' +
      MODE_HINT,
    meta: toolMeta,
    annotations: solvapayTool({}),
  })

  return tools
}

/** Ordered prompt metadata for enabled views (`activate_plan` when checkout enabled). */
export function buildPromptDescriptorMetadata(
  options: BuildPromptDescriptorMetadataOptions = {},
): PromptDescriptorMetadata[] {
  const enabled = new Set<SolvaPayMcpViewKind>(options.views ?? DEFAULT_VIEWS)
  const prompts: PromptDescriptorMetadata[] = []

  if (enabled.has('checkout')) {
    prompts.push({
      name: MCP_TOOL_NAMES.upgrade,
      title: 'Upgrade plan',
      description: 'Start or change a paid plan for the current customer.',
    })
  }
  if (enabled.has('account')) {
    prompts.push({
      name: MCP_TOOL_NAMES.manageAccount,
      title: 'Manage account',
      description:
        'Show the current plan, balance, payment method, and cancel/reactivate controls for the current customer.',
    })
  }
  if (enabled.has('topup')) {
    prompts.push({
      name: MCP_TOOL_NAMES.topup,
      title: 'Top up credits',
      description: 'Add SolvaPay credits to the current customer.',
    })
  }
  if (enabled.has('checkout')) {
    prompts.push({
      name: MCP_TOOL_NAMES.activatePlan,
      title: 'Activate plan',
      description: 'Pick a plan to activate, or activate a specific plan by ref.',
    })
  }

  return prompts
}

/** Pure user-message text for a SolvaPay slash-command prompt. */
export function buildPromptUserMessage(
  promptName: McpToolName,
  args: Record<string, unknown>,
): SolvaPayPromptResult {
  const text = promptUserMessageText(promptName, args)
  return {
    messages: [{ role: 'user', content: { type: 'text', text } }],
  }
}

function promptUserMessageText(
  promptName: McpToolName,
  args: Record<string, unknown>,
): string {
  switch (promptName) {
    case MCP_TOOL_NAMES.upgrade: {
      const planRef = args.planRef
      return typeof planRef === 'string' && planRef
        ? `Activate plan ${planRef} for me.`
        : 'Show me the upgrade options for my SolvaPay account.'
    }
    case MCP_TOOL_NAMES.manageAccount:
      return 'Show me my SolvaPay account.'
    case MCP_TOOL_NAMES.topup: {
      const amount = args.amount
      return typeof amount === 'string' && amount
        ? `Top up my SolvaPay credits by ${amount}.`
        : 'I want to top up my SolvaPay credits.'
    }
    case MCP_TOOL_NAMES.activatePlan: {
      const planRef = args.planRef
      return typeof planRef === 'string' && planRef
        ? `Activate plan ${planRef} on my SolvaPay account.`
        : 'What plans can I activate on my SolvaPay account?'
    }
    default:
      return ''
  }
}
