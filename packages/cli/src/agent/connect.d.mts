export interface LauncherDeps {
  env?: Record<string, string | undefined>
  /** What the agent (or person) running the command reads: stdout. */
  out?: (text: string) => void
  /** Progress for the person: stderr. */
  say?: (text: string) => void
  sleep?: (ms: number) => Promise<void>
  run?: (command: string, args: string[], env: Record<string, string | undefined>, cwd?: string) => Promise<number>
}
export const DEFAULT_API: string
export function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string>; rest?: string[] }
/** `launch …` or `connect <providerRef> …`; resolves to the exit code. */
export function main(argv: string[], deps?: LauncherDeps): Promise<number>
export function keyEnvName(providerRef: string): string
export function serverName(merchantName: string): string
export function saveForHermes(env: Record<string, string | undefined>, state: unknown, answer: unknown): Promise<void>
