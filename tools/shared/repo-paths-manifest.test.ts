import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from './paths.js'
import { RepoPathsManifestSchema } from './repo-paths-schema.js'
import {
  dirPath,
  dtoGenArgs,
  generatedDriftPaths,
  loadRepoPathsManifest,
  lookupPath,
  mcpAppWidgetLayout,
  REPO_PATHS_MANIFEST_REL,
  sdkPath,
} from './repo-paths.js'

/** Frozen copy of `GENERATED_PATHS` in tools/codegen/gen.ts before this tier. */
const LEGACY_GENERATED_PATHS = [
  'core/solvapay-dto',
  'sdks/typescript/server/src/types/overlays.generated.d.ts',
  'sdks/typescript/server/src/types/client.generated.d.ts',
  'sdks/typescript/server/src/client.runtime.generated.ts',
  'sdks/typescript/server/src/types/generated.ts',
  'sdks/typescript/server/src/__generated__/signature-parity.generated.test.ts',
  'sdks/typescript/server/src/native.ts',
  'sdks/typescript/server/src/wasm.ts',
  'contract/manifest/binding-symbols.snapshot.json',
  'contract/manifest/facade-coverage.json',
  'sdks/wasm/browser-symbols.generated.json',
  'contract/manifest/boundary-types.snapshot.json',
  'sdks/typescript/core/src/types/boundary.generated.d.ts',
  'sdks/typescript/core/src/native-dispatch.ts',
  'sdks/typescript/core/src/native-core.ts',
  'sdks/typescript/core/src/native-helpers.ts',
  'sdks/typescript/server/src/native-decisions.ts',
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
  'sdks/python/python/solvapay/helpers.generated.py',
  'sdks/python/tests/signature_parity_generated_test.py',
  'sdks/python/tests/contract/__init__.py',
  'sdks/python/tests/contract/clock.py',
  'sdks/python/tests/contract/names.py',
  'sdks/python/tests/contract/fixture_loader.py',
  'sdks/python/tests/contract/compare.py',
  'sdks/python/tests/contract/stub_backend.py',
  'sdks/python/tests/contract/host_adapters.py',
  'sdks/python/tests/contract/dispatch.py',
  'sdks/ruby/ext/solvapay/src/args.rs',
  'sdks/ruby/ext/solvapay/src/decisions.rs',
  'sdks/ruby/ext/solvapay/src/payload_builders.rs',
  'sdks/ruby/ext/solvapay/src/client.rs',
  'sdks/ruby/ext/solvapay/src/register.rs',
  'sdks/ruby/lib/solvapay/_native.rb',
  'sdks/ruby/lib/solvapay/client.rb',
  'sdks/ruby/lib/solvapay/helpers.generated.rb',
  'sdks/ruby/sig/solvapay.rbs',
  'sdks/ruby-mcp/sig/layer2.generated.rbs',
  'sdks/ruby/test/signature_parity_generated_test.rb',
  'sdks/ruby/test/contract/clock.rb',
  'sdks/ruby/test/contract/names.rb',
  'sdks/ruby/test/contract/fixture_loader.rb',
  'sdks/ruby/test/contract/compare.rb',
  'sdks/ruby/test/contract/stub_backend.rb',
  'sdks/ruby/test/contract/host_adapters.rb',
  'sdks/ruby/test/contract/dispatch.rb',
  'sdks/rust/src/client_generated.rs',
  'sdks/rust/src/helpers_generated.rs',
  'sdks/rust/src/blocking_generated.rs',
  'sdks/rust/tests/signature_parity_generated.rs',
  'sdks/go/wasm/src/args.rs',
  'sdks/go/wasm/src/decisions.rs',
  'sdks/go/wasm/src/payload_builders.rs',
  'sdks/go/wasm/src/client.rs',
  'sdks/go/wasm/src/webhook.rs',
  'sdks/go/client_generated.go',
  'sdks/go/helpers_generated.go',
  'sdks/go/signature_parity_generated_test.go',
  'sdks/go/internal/contract/clock.go',
  'sdks/go/internal/contract/names.go',
  'sdks/go/internal/contract/fixture_loader.go',
  'sdks/go/internal/contract/compare.go',
  'sdks/go/internal/contract/stub_backend.go',
  'sdks/go/internal/contract/host_adapters.go',
  'sdks/go/internal/contract/dispatch.go',
  'sdks/capi/src/dispatch.rs',
  'sdks/capi/ctest/contract/dispatch.c',
  'sdks/capi/ctest/contract/dispatch.h',
  'sdks/capi/ctest/contract/harness.c',
  'sdks/capi/ctest/contract/harness.h',
  'sdks/capi/ctest/signature_parity_generated.c',
  'tools/conformance/fixture-runner/src/registry.rs',
  'sdks/ruby-mcp/lib/solvapay/mcp/layer2.generated.rb',
  'sdks/python-mcp/python/solvapay_mcp/_layer2.generated.py',
  'sdks/go/mcp/layer2_generated.go',
  'sdks/typescript/mcp-core/src/native-mcp.generated.ts',
  'sdks/rust-mcp/src/layer2_generated.rs',
] as const

/** Frozen copy of `DTO_GEN_ARGS` in tools/codegen/gen.ts before this tier. */
const LEGACY_DTO_GEN_ARGS = [
  '--snapshot',
  'contract/openapi/sdk-v1.snapshot.json',
  '--manifest',
  'contract/manifest/sdk-contract.yaml',
  '--core-src',
  'core/solvapay-core/src',
  '--binding-residue',
  'contract/manifest/binding-residue.yaml',
  '--transport-src',
  'core/solvapay-transport/src',
  '--out',
  'core/solvapay-dto/src',
  '--ts-out',
  'sdks/typescript/server/src/types/overlays.generated.d.ts',
  '--ts-client-out',
  'sdks/typescript/server/src/types/client.generated.d.ts',
  '--ts-client-runtime-out',
  'sdks/typescript/server/src/client.runtime.generated.ts',
  '--ts-parity-out',
  'sdks/typescript/server/src/__generated__/signature-parity.generated.test.ts',
  '--dump-bindings',
  'contract/manifest/binding-symbols.snapshot.json',
  '--dump-boundary-types',
  'contract/manifest/boundary-types.snapshot.json',
  '--core-types-ts-out',
  'sdks/typescript/core/src/types/boundary.generated.d.ts',
  '--core-dispatch-ts-out',
  'sdks/typescript/core/src/native-dispatch.ts',
  '--core-native-ts-out',
  'sdks/typescript/core/src/native-core.ts',
  '--core-helpers-ts-out',
  'sdks/typescript/core/src/native-helpers.ts',
  '--server-decisions-ts-out',
  'sdks/typescript/server/src/native-decisions.ts',
  '--node-bindings-out',
  'sdks/node-native/src',
  '--wasm-bindings-out',
  'sdks/wasm/src',
  '--python-bindings-out',
  'sdks/python/src',
  '--ruby-bindings-out',
  'sdks/ruby/ext/solvapay/src',
  '--native-ts-out',
  'sdks/typescript/server/src/native.ts',
  '--wasm-ts-out',
  'sdks/typescript/server/src/wasm.ts',
  '--native-py-out',
  'sdks/python/python/solvapay/_native.py',
  '--py-stub-out',
  'sdks/python/python/solvapay/__init__.pyi',
  '--py-helpers-out',
  'sdks/python/python/solvapay/helpers.generated.py',
  '--py-parity-out',
  'sdks/python/tests/signature_parity_generated_test.py',
  '--py-conformance-out',
  'sdks/python/tests/contract',
  '--native-rb-out',
  'sdks/ruby/lib/solvapay/_native.rb',
  '--rb-client-out',
  'sdks/ruby/lib/solvapay/client.rb',
  '--rb-rbs-out',
  'sdks/ruby/sig/solvapay.rbs',
  '--rb-mcp-rbs-out',
  'sdks/ruby-mcp/sig/layer2.generated.rbs',
  '--rb-parity-out',
  'sdks/ruby/test/signature_parity_generated_test.rb',
  '--rb-conformance-out',
  'sdks/ruby/test/contract',
  '--rs-client-out',
  'sdks/rust/src/client_generated.rs',
  '--rs-helpers-out',
  'sdks/rust/src/helpers_generated.rs',
  '--rs-parity-out',
  'sdks/rust/tests/signature_parity_generated.rs',
  '--go-bindings-out',
  'sdks/go/wasm/src',
  '--go-client-out',
  'sdks/go/client_generated.go',
  '--go-helpers-out',
  'sdks/go/helpers_generated.go',
  '--go-parity-out',
  'sdks/go/signature_parity_generated_test.go',
  '--go-conformance-out',
  'sdks/go/internal/contract',
  '--c-bindings-out',
  'sdks/capi/src',
  '--c-conformance-out',
  'sdks/capi/ctest/contract',
  '--c-parity-out',
  'sdks/capi/ctest/signature_parity_generated.c',
  '--fixture-runner-out',
  'tools/conformance/fixture-runner/src/registry.rs',
  '--rb-mcp-layer2-out',
  'sdks/ruby-mcp/lib/solvapay/mcp/layer2.generated.rb',
  '--py-mcp-layer2-out',
  'sdks/python-mcp/python/solvapay_mcp/_layer2.generated.py',
  '--go-mcp-layer2-out',
  'sdks/go/mcp/layer2_generated.go',
  '--ts-mcp-native-out',
  'sdks/typescript/mcp-core/src/native-mcp.generated.ts',
  '--rs-mcp-layer2-out',
  'sdks/rust-mcp/src/layer2_generated.rs',
] as const

describe('repo-paths manifest', () => {
  it('parses against the zod schema', () => {
    const manifest = loadRepoPathsManifest()
    expect(manifest.version).toBe(1)
    expect(Object.keys(manifest.sdks).sort()).toEqual(
      Object.keys(RepoPathsManifestSchema.shape.sdks.shape).sort(),
    )
  })

  it("derives a generated-path set equal to today's GENERATED_PATHS", () => {
    expect(generatedDriftPaths()).toEqual([...LEGACY_GENERATED_PATHS])
  })

  it('keeps generatedDriftPaths on the committed generated-path list after externalGenerated', () => {
    expect(generatedDriftPaths()).toHaveLength(LEGACY_GENERATED_PATHS.length)
    expect(generatedDriftPaths()).toEqual([...LEGACY_GENERATED_PATHS])
  })

  it('invokes dto-gen with --config pointing at the repo-paths manifest', () => {
    expect(dtoGenArgs()).toEqual(['--config', REPO_PATHS_MANIFEST_REL])
  })

  it('still resolves every GenOutputs / contract-input flag from the manifest', () => {
    const manifest = loadRepoPathsManifest()
    const flags = new Set<string>()
    for (const item of Object.values(manifest.contractInputs)) {
      if (item.flag !== undefined) {
        flags.add(item.flag)
      }
    }
    for (const item of manifest.generated) {
      if (item.flag !== undefined) {
        flags.add(item.flag)
      }
    }
    const expected = new Set(LEGACY_DTO_GEN_ARGS.filter((entry, index) => index % 2 === 0))
    expect([...flags].sort()).toEqual([...expected].sort())
  })

  it('resolves sdkPath under the repo root', () => {
    const resolved = sdkPath('python')
    expect(resolved.startsWith(REPO_ROOT)).toBe(true)
    expect(existsSync(resolved)).toBe(true)
  })

  it('throws for an unknown sdkPath key', () => {
    expect(() => sdkPath('not-a-surface')).toThrow(/unknown sdk surface/)
  })

  it('resolves dirPath under the repo root', () => {
    const resolved = dirPath('contract')
    expect(resolved.startsWith(REPO_ROOT)).toBe(true)
    expect(existsSync(resolved)).toBe(true)
  })

  it('catalogues the MCP App widget artifact and every SDK copy', () => {
    const layout = mcpAppWidgetLayout()
    expect(existsSync(lookupPath('mcpAppWidgetCanonical'))).toBe(true)
    expect(layout.copiesRel).toHaveLength(5)
    for (const rel of [layout.canonicalRel, layout.distRel, ...layout.copiesRel]) {
      expect(rel.includes('\\')).toBe(false)
      expect(rel.startsWith('/')).toBe(false)
    }
    for (const rel of [layout.canonicalRel, ...layout.copiesRel]) {
      expect(existsSync(path.join(REPO_ROOT, rel)), rel).toBe(true)
    }
  })

  it('catalogues the example widget copies used by the parity gate', () => {
    const keys = [
      'exampleWidgetHtmlCloudflare',
      'exampleWidgetHtmlSupabase',
      'exampleWidgetHtmlCheckout',
      'exampleWidgetHtmlScaffold',
      'exampleWidgetTsxCloudflare',
      'exampleWidgetTsxSupabase',
      'exampleWidgetTsxCheckout',
      'exampleWidgetTsxScaffold',
      'exampleDemoToolsCloudflare',
      'exampleDemoToolsSupabase',
    ]
    for (const key of keys) {
      const resolved = lookupPath(key)
      expect(resolved.startsWith(REPO_ROOT)).toBe(true)
      expect(existsSync(resolved), key).toBe(true)
    }
  })

  it('throws when a required widget lookup is missing', () => {
    const manifest = loadRepoPathsManifest()
    const { mcpAppWidgetCanonical: _removed, ...lookups } = manifest.lookups
    expect(() => mcpAppWidgetLayout({ ...manifest, lookups })).toThrow(/mcpAppWidgetCanonical/)
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
