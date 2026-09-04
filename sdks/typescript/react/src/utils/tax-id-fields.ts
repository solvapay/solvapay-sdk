export type McpTaxIdFieldCopy = {
  label?: string | null
  example?: string | null
  helperText?: string | null
}

let taxIdFieldsTable: Record<string, McpTaxIdFieldCopy> | null = null

/** Seed the country → tax-ID copy table from MCP bootstrap. */
export function seedTaxIdFields(table: Record<string, McpTaxIdFieldCopy> | null | undefined): void {
  taxIdFieldsTable = table ?? null
}

/** Look up bootstrap-precomputed tax-ID copy for a country code. */
export function lookupTaxIdField(country: string): McpTaxIdFieldCopy | null {
  if (!taxIdFieldsTable || !country) return null
  return taxIdFieldsTable[country] ?? taxIdFieldsTable[country.toUpperCase()] ?? null
}
