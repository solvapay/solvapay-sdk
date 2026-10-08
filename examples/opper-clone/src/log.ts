/** One JSON line per event. Never pass keys or secrets in `fields`. */
export interface Logger {
  info(event: string, fields?: Record<string, unknown>): void
  error(event: string, fields?: Record<string, unknown>): void
}

function line(event: string, fields?: Record<string, unknown>): string {
  return `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`
}

export const consoleLogger: Logger = {
  info: (event, fields) => process.stdout.write(line(event, fields)),
  error: (event, fields) => process.stderr.write(line(event, fields)),
}
