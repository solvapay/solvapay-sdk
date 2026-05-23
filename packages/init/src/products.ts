export type ProductSummary = {
  reference: string
  name: string
  status: string
  createdAt: string
}

export type ListProductsResult =
  | { ok: true; products: ProductSummary[]; total: number }
  | { ok: false; warning: string }

const parseProductSummary = (value: unknown): ProductSummary | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.reference !== 'string' ||
    typeof record.name !== 'string' ||
    typeof record.status !== 'string' ||
    typeof record.createdAt !== 'string'
  ) {
    return null
  }

  return {
    reference: record.reference,
    name: record.name,
    status: record.status,
    createdAt: record.createdAt,
  }
}

export const listProducts = async (
  apiBaseUrl: string,
  secretKey: string,
  options: { limit?: number } = {},
): Promise<ListProductsResult> => {
  const limit = options.limit ?? 10

  try {
    const response = await fetch(`${apiBaseUrl}/v1/sdk/products?limit=${limit}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    })

    if (!response.ok) {
      const body = await response.text()
      return {
        ok: false,
        warning: `Product listing failed (${response.status}): ${body}`,
      }
    }

    const payload = (await response.json()) as {
      products?: unknown[]
      total?: number
    }

    const products = (payload.products ?? [])
      .map(parseProductSummary)
      .filter((product): product is ProductSummary => product !== null)

    return {
      ok: true,
      products,
      total: typeof payload.total === 'number' ? payload.total : products.length,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error'
    return {
      ok: false,
      warning: `Product listing failed due to network error: ${message}`,
    }
  }
}
