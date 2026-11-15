type Env = Record<string, string | undefined>
export function solvapayHome(env: Env): string
export function keyPath(env: Env, providerRef: string): string
export function pendingPath(env: Env, providerRef: string): string
export function agentDir(env: Env, agent: string, providerRef: string): string
export function saveKey(env: Env, saved: Record<string, unknown>): Promise<void>
export function readKey(env: Env, providerRef: string): Promise<Record<string, unknown> | undefined>
export function savePending(env: Env, providerRef: string, state: Record<string, unknown>): Promise<void>
export function readPending(env: Env, providerRef: string): Promise<Record<string, unknown> | undefined>
export function dropPending(env: Env, providerRef: string): Promise<void>
