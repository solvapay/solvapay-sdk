import { pathToFileURL } from 'node:url'
import { isAbsolute, resolve } from 'node:path'

/**
 * @param {string} configPath
 * @param {string} [target]
 */
export async function loadConfig(configPath, target) {
  const absolute = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath)
  const mod = await import(pathToFileURL(absolute).href)
  const picked = target
    ? (mod[target] ?? mod.configs?.[target])
    : (mod.default ?? mod.dev ?? mod.example)
  if (!picked) {
    throw new Error(
      target
        ? `No "${target}" export in ${absolute}`
        : `No default deploy config export in ${absolute}`,
    )
  }
  return {
    wranglerBin: ['pnpm', 'exec', 'wrangler'],
    requiredVars: [
      'SOLVAPAY_SECRET_KEY',
      'SOLVAPAY_PRODUCT_REF',
      'MCP_PUBLIC_BASE_URL',
      'SOLVAPAY_API_BASE_URL',
    ],
    overridableVars: ['SOLVAPAY_PRODUCT_REF', 'MCP_PUBLIC_BASE_URL', 'SOLVAPAY_API_BASE_URL'],
    secretKeyMode: 'dev',
    ...picked,
    cwd: picked.cwd ?? resolve(absolute, '..'),
  }
}
