/**
 * Read a human-readable error message from a non-OK fetch response.
 * Prefers `{ error }` from JSON body; falls back to `fallbackPrefix: status`.
 */
export async function readErrorMessage(res: Response, fallbackPrefix: string): Promise<string> {
  let serverMessage: string | undefined
  try {
    const data = (await res.clone().json()) as { error?: string }
    serverMessage = data?.error
  } catch {
    // ignore: response may not be JSON
  }

  return serverMessage || `${fallbackPrefix}: ${res.statusText || res.status}`
}
