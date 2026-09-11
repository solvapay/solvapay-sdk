import type { AdditionalToolsContext } from '@solvapay/mcp'
import type { Env } from '../worker'
import { register__TOOL_NAME_PASCAL__ } from './__TOOL_NAME__'

export function registerTools(ctx: AdditionalToolsContext, _env: Env): void {
  register__TOOL_NAME_PASCAL__(ctx)
}
