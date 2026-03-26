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

const mainEl = document.querySelector('.main') as HTMLElement
const timeValueEl = document.getElementById('time-value') as HTMLElement
const refreshButton = document.getElementById('refresh-time-btn') as HTMLButtonElement

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

function updateTimeFromResult(result: CallToolResult) {
  const payload = (result.structuredContent as TimeResult) ?? {}
  timeValueEl.textContent = payload.currentTime ?? 'Time unavailable'
}

async function refreshTime() {
  try {
    const result = await app.callServerTool({
      name: 'get-current-time',
      arguments: {},
    })
    updateTimeFromResult(result)
  } catch {
    timeValueEl.textContent = 'Error updating time'
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
