import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import './global.css'
import './mcp-app.css'

type TimeResult = {
  currentTime?: string
}

type PaywallResult = {
  kind: 'payment_required'
  checkoutUrl: string
  message: string
}

const mainEl = document.querySelector('.main') as HTMLElement
const timeValueEl = document.getElementById('time-value') as HTMLElement
const refreshButton = document.getElementById('refresh-time-btn') as HTMLButtonElement
const paywallEl = document.getElementById('paywall') as HTMLElement
const paywallMessageEl = document.getElementById('paywall-message') as HTMLElement
const paywallLinkEl = document.getElementById('paywall-link') as HTMLAnchorElement

const app = new App({ name: 'MCP Time App', version: '1.0.0' })

function applyContext(ctx: McpUiHostContext) {
  if (ctx.theme) {
    applyDocumentTheme(ctx.theme)
  }

  if (ctx.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables)
  }

  if (ctx.styles?.css?.fonts) {
    applyHostFonts(ctx.styles.css.fonts)
  }

  if (ctx.safeAreaInsets) {
    mainEl.style.paddingTop = `${20 + ctx.safeAreaInsets.top}px`
    mainEl.style.paddingRight = `${20 + ctx.safeAreaInsets.right}px`
    mainEl.style.paddingBottom = `${20 + ctx.safeAreaInsets.bottom}px`
    mainEl.style.paddingLeft = `${20 + ctx.safeAreaInsets.left}px`
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toPaywallResult(value: unknown): PaywallResult | null {
  if (!isRecord(value)) {
    return null
  }

  const kind = value.kind
  const checkoutUrl = value.checkoutUrl
  const message = value.message

  if (kind === 'payment_required' && typeof checkoutUrl === 'string' && typeof message === 'string') {
    return { kind, checkoutUrl, message }
  }

  if (typeof checkoutUrl === 'string' && typeof message === 'string') {
    return {
      kind: 'payment_required',
      checkoutUrl,
      message,
    }
  }

  return null
}

function showTime(message: string) {
  paywallEl.hidden = true
  timeValueEl.hidden = false
  refreshButton.hidden = false
  timeValueEl.textContent = message
}

function showPaywall(paywall: PaywallResult) {
  timeValueEl.hidden = true
  refreshButton.hidden = true
  paywallMessageEl.textContent = paywall.message
  paywallLinkEl.href = paywall.checkoutUrl
  paywallEl.hidden = false
}

function updateTimeFromResult(result: CallToolResult) {
  const paywall = toPaywallResult(result.structuredContent)
  if (paywall) {
    showPaywall(paywall)
    return
  }

  const payload = (result.structuredContent as TimeResult) ?? {}
  showTime(payload.currentTime ?? 'Time unavailable')
}

function extractPaywallFromError(error: unknown): PaywallResult | null {
  if (!isRecord(error)) {
    return null
  }

  const structuredContentPaywall = toPaywallResult(error.structuredContent)
  if (structuredContentPaywall) {
    return structuredContentPaywall
  }

  if (!Array.isArray(error.content)) {
    return null
  }

  for (const contentBlock of error.content) {
    if (!isRecord(contentBlock) || typeof contentBlock.text !== 'string') {
      continue
    }

    try {
      const parsed = JSON.parse(contentBlock.text) as unknown
      const paywall = toPaywallResult(parsed)
      if (paywall) {
        return paywall
      }
    } catch {}
  }

  return null
}

async function refreshTime() {
  try {
    const result = await app.callServerTool({
      name: 'get-current-time',
      arguments: {},
    })
    updateTimeFromResult(result)
  } catch (error) {
    const paywall = extractPaywallFromError(error)
    if (paywall) {
      showPaywall(paywall)
      return
    }

    showTime('Error updating time')
  }
}

app.ontoolresult = result => {
  updateTimeFromResult(result)
}

app.onhostcontextchanged = ctx => {
  applyContext(ctx)
}

app.onteardown = async () => ({})

refreshButton.addEventListener('click', refreshTime)

await app.connect()

const initialContext = app.getHostContext()
if (initialContext) {
  applyContext(initialContext)
}

await refreshTime()
