const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const RANDOM_LENGTH = 9
// The largest multiple of 36 that fits in a byte. Bytes at or above it are
// skipped, so every character is equally likely.
const UNBIASED_LIMIT = 252

/**
 * A paywall request id: `solvapay_<ms>_<9 random characters>`.
 *
 * The random part is always nine characters from `a-z0-9`, drawn from Web
 * Crypto (Node 22+ and every edge runtime this package targets), as the Go
 * and Python SDKs draw theirs. `Math.random().toString(36)` came out shorter
 * now and then, which the conformance cases do not allow.
 */
export function generateRequestId(now: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  let random = ''
  while (random.length < RANDOM_LENGTH) {
    globalThis.crypto.getRandomValues(bytes)
    for (const byte of bytes) {
      if (byte >= UNBIASED_LIMIT) continue
      random += ALPHABET[byte % ALPHABET.length]
      if (random.length === RANDOM_LENGTH) break
    }
  }
  return `solvapay_${now}_${random}`
}
