'use client'

/**
 * Single identity caption that replaced the Seller / Your account cards.
 * Merchant name and "Paying as {email}" share one muted line.
 */

import React from 'react'

export interface McpProvenanceLineProps {
  merchantName?: string | null
  email?: string | null
}

export function formatProvenanceLine(
  merchantName?: string | null,
  email?: string | null,
): string | null {
  const merchant = merchantName?.trim() ?? ''
  const payingAs = email?.trim() ? `Paying as ${email.trim()}` : ''
  if (merchant && payingAs) return `${merchant} · ${payingAs}`
  if (payingAs) return payingAs
  if (merchant) return merchant
  return null
}

export function McpProvenanceLine({
  merchantName,
  email,
}: McpProvenanceLineProps): React.ReactElement | null {
  const text = formatProvenanceLine(merchantName, email)
  if (!text) return null
  return <p className="solvapay-mcp-provenance">{text}</p>
}
