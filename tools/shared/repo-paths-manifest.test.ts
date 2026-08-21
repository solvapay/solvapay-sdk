import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './paths.js'
import {
  dtoGenArgs,
  generatedDriftPaths,
  loadRepoPathsManifest,
} from './repo-paths.js'

/** Frozen copy of `GENERATED_PATHS` in tools/codegen/gen.ts before this tier. */
const LEGACY_GENERATED_PATHS = [
  'core/solvapay-dto',
  'packages/server/src/types/overlays.generated.d.ts',
  'packages/server/src/types/client.generated.d.ts',
  'packages/server/src/__generated__/signature-parity.generated.test.ts',
  'packages/server/src/native.ts',
  'packages/server/src/wasm.ts',
  'contract/manifest/binding-symbols.snapshot.json',
  'sdks/node-native/src/args.rs',
  'sdks/node-native/src/decisions.rs',
  'sdks/node-native/src/payload_builders.rs',
  'sdks/node-native/src/native_client.rs',
  'sdks/wasm/src/args.rs',
  'sdks/wasm/src/decisions.rs',
  'sdks/wasm/src/payload_builders.rs',
  'sdks/wasm/src/wasm_client.rs',
  'sdks/python/src/args.rs',
  'sdks/python/src/decisions.rs',
  'sdks/python/src/payload_builders.rs',
  'sdks/python/src/client.rs',
  'sdks/python/src/register.rs',
  'sdks/python/python/solvapay/_native.py',
  'sdks/python/python/solvapay/__init__.pyi',
  'sdks/python/tests/signature_parity_generated_test.py',
  'sdks/ruby/ext/solvapay/src/args.rs',
  'sdks/ruby/ext/solvapay/src/decisions.rs',
  'sdks/ruby/ext/solvapay/src/payload_builders.rs',
  'sdks/ruby/ext/solvapay/src/client.rs',
  'sdks/ruby/ext/solvapay/src/register.rs',
  'sdks/ruby/lib/solvapay/_native.rb',
  'sdks/ruby/lib/solvapay/client.rb',
  'sdks/ruby/lib/solvapay/helpers.generated.rb',
  'sdks/ruby/sig/solvapay.rbs',
  'sdks/ruby/test/signature_parity_generated_test.rb',
  'sdks/rust/src/client_generated.rs',
  'sdks/rust/src/blocking_generated.rs',
  'sdks/rust/tests/signature_parity_generated.rs',
  'sdks/go/wasm/src/args.rs',
  'sdks/go/wasm/src/client.rs',
  'sdks/go/wasm/src/webhook.rs',
  'sdks/go/client_generated.go',
  'sdks/go/signature_parity_generated_test.go',
  'sdks/capi/src/dispatch.rs',
  'tools/conformance/fixture-runner/src/registry.rs',
] as const

/** Frozen copy of `DTO_GEN_ARGS` in tools/codegen/gen.ts before this tier. */
const LEGACY_DTO_GEN_ARGS = [
  '--snapshot',
  'contract/openapi/sdk-v1.snapshot.json',
  '--manifest',
  'contract/manifest/sdk-contract.yaml',
  '--out',
  'core/solvapay-dto/src',
  '--ts-out',
  'packages/server/src/types/overlays.generated.d.ts',
  '--ts-client-out',
  'packages/server/src/types/client.generated.d.ts',
  '--ts-parity-out',
  'packages/server/src/__generated__/signature-parity.generated.test.ts',
  '--dump-bindings',
  'contract/manifest/binding-symbols.snapshot.json',
  '--node-bindings-out',
  'sdks/node-native/src',
  '--wasm-bindings-out',
  'sdks/wasm/src',
  '--python-bindings-out',
  'sdks/python/src',
  '--ruby-bindings-out',
  'sdks/ruby/ext/solvapay/src',
  '--native-ts-out',
  'packages/server/src/native.ts',
  '--wasm-ts-out',
  'packages/server/src/wasm.ts',
  '--native-py-out',
  'sdks/python/python/solvapay/_native.py',
  '--py-stub-out',
  'sdks/python/python/solvapay/__init__.pyi',
  '--py-parity-out',
  'sdks/python/tests/signature_parity_generated_test.py',
  '--native-rb-out',
  'sdks/ruby/lib/solvapay/_native.rb',
  '--rb-client-out',
  'sdks/ruby/lib/solvapay/client.rb',
  '--rb-rbs-out',
  'sdks/ruby/sig/solvapay.rbs',
  '--rb-parity-out',
  'sdks/ruby/test/signature_parity_generated_test.rb',
  '--rs-client-out',
  'sdks/rust/src/client_generated.rs',
  '--rs-parity-out',
  'sdks/rust/tests/signature_parity_generated.rs',
  '--go-bindings-out',
  'sdks/go/wasm/src',
  '--go-client-out',
  'sdks/go/client_generated.go',
  '--go-parity-out',
  'sdks/go/signature_parity_generated_test.go',
  '--c-bindings-out',
  'sdks/capi/src',
  '--fixture-runner-out',
  'tools/conformance/fixture-runner/src/registry.rs',
] as const

describe('repo-paths manifest', () => {
  it('parses against the zod schema', () => {
    const manifest = loadRepoPathsManifest()
    expect(manifest.version).toBe(1)
    expect(Object.keys(manifest.sdks)).toHaveLength(8)
  })

  it('derives a generated-path set equal to today\'s GENERATED_PATHS', () => {
    expect(generatedDriftPaths()).toEqual([...LEGACY_GENERATED_PATHS])
  })

  it('derives dto-gen argv equal to today\'s DTO_GEN_ARGS', () => {
    expect(dtoGenArgs()).toEqual([...LEGACY_DTO_GEN_ARGS])
  })

  it('every generated path and contract input exists on disk', () => {
    const manifest = loadRepoPathsManifest()
    for (const input of Object.values(manifest.contractInputs)) {
      expect(existsSync(path.join(REPO_ROOT, input.path)), input.path).toBe(true)
    }
    for (const item of manifest.generated) {
      expect(existsSync(path.join(REPO_ROOT, item.path)), item.path).toBe(true)
    }
  })
})
