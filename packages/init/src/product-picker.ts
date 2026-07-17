import readline from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { listProducts, type ProductSummary } from './products'

const CONSOLE_PRODUCTS_URL = 'https://app.solvapay.com/products'

export type PickResult =
  | { action: 'picked'; product: ProductSummary }
  | { action: 'declined' }
  | { action: 'skipped'; reason: 'zero_products' | 'network_error' | 'non_interactive_requires_product' }

type PickOptions = {
  yes: boolean
}

const askYesNo = async (prompt: string, defaultYes: boolean): Promise<boolean> => {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    const answer = (await rl.question(prompt)).trim().toLowerCase()
    if (answer === '') {
      return defaultYes
    }
    return answer === 'y' || answer === 'yes'
  } finally {
    rl.close()
  }
}

const askProductIndex = async (count: number): Promise<number | null> => {
  const rl = readline.createInterface({ input: stdin, output: stdout })
  try {
    while (true) {
      const answer = (await rl.question(`Pick a product [1-${count}] (default 1): `)).trim()
      if (answer === '') {
        return 0
      }

      const parsed = Number.parseInt(answer, 10)
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= count) {
        return parsed - 1
      }
    }
  } finally {
    rl.close()
  }
}

export const formatConfiguredProductLabel = (
  productRef: string,
  products: ProductSummary[],
): string => {
  const match = products.find(product => product.reference === productRef)
  if (match) {
    return `${match.name} (${productRef})`
  }
  return productRef
}

export const askKeepConfiguredProduct = async (label: string): Promise<boolean> =>
  askYesNo(`Currently configured: ${label}. Keep this? [Y/n] `, true)

const printProductList = (products: ProductSummary[], total: number): void => {
  process.stdout.write('\nProducts on your account:\n')
  products.forEach((product, index) => {
    process.stdout.write(`  ${index + 1}. ${product.name} (${product.reference})\n`)
  })
  if (total > products.length) {
    process.stdout.write(`  …and ${total - products.length} more in Console.\n`)
  }
  process.stdout.write('\n')
}

export const pickProductInteractive = async (
  apiBaseUrl: string,
  secretKey: string,
  options: PickOptions,
): Promise<PickResult> => {
  const listResult = await listProducts(apiBaseUrl, secretKey)

  if (!listResult.ok) {
    process.stdout.write(
      `⚠️ Could not list products: ${listResult.warning}. Skipping product configuration.\n`,
    )
    return { action: 'skipped', reason: 'network_error' }
  }

  const { products, total } = listResult

  if (total === 0) {
    process.stdout.write(
      `⚠️ No products found on your SolvaPay account. Create one at ${CONSOLE_PRODUCTS_URL} and re-run \`solvapay init\`.\n`,
    )
    return { action: 'skipped', reason: 'zero_products' }
  }

  const nonInteractive = options.yes || !process.stdin.isTTY || !process.stdout.isTTY
  if (nonInteractive) {
    process.stdout.write(
      'Skipped product auto-selection in non-interactive mode. Set SOLVAPAY_PRODUCT_REF in .env or pass --product <prd_...> when you are ready.\n',
    )
    return { action: 'skipped', reason: 'non_interactive_requires_product' }
  }

  if (products.length === 1) {
    const product = products[0]
    const accepted = await askYesNo(
      `Use product "${product.name}" (${product.reference})? [Y/n] `,
      true,
    )
    if (accepted) {
      return { action: 'picked', product }
    }
    return { action: 'declined' }
  }

  printProductList(products, total)
  const index = await askProductIndex(products.length)
  if (index === null) {
    return { action: 'declined' }
  }

  return { action: 'picked', product: products[index] }
}
