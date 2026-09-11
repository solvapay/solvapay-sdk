import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { lookupPath } from '../../shared/repo-paths.js'

const canonicalPath = lookupPath('mcpAppWidgetCanonical')

describe('MCP App widget boot', () => {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })

  afterAll(async () => {
    await browser?.close()
  })

  it('boots without pageerrors and mounts markup into #root', async () => {
    if (browser === undefined) {
      throw new Error('Chromium failed to launch')
    }
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', error => {
      errors.push(error.message)
    })

    await page.goto(pathToFileURL(canonicalPath).href)
    await page.waitForTimeout(4000)

    const rootLen = await page.evaluate(() => {
      const root = document.getElementById('root')
      if (root === null) {
        throw new Error('#root is missing')
      }
      return root.innerHTML.length
    })

    expect(errors, errors.join('\n')).toEqual([])
    expect(rootLen).toBeGreaterThan(0)
  })
})
