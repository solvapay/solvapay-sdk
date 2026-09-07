import type { Plugin } from 'vite'

export function defaultBrowserWasmPath(): string
export function inlineBrowserWasmBase64(wasmPath?: string): Plugin
