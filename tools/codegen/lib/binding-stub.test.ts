import { describe, expect, it } from 'vitest'
import { insertSectionEntry, sectionHasEntry } from './manifest-edit.js'
import { bindingStubFields, nextClientEmitOrder } from './binding-stub.js'

describe('sectionHasEntry', () => {
  it('detects a key only inside the named section', () => {
    const text = 'operations:\n  foo:\n    x: 1\nbindings:\n  bar:\n    y: 2\n'
    expect(sectionHasEntry(text, 'operations', 'foo')).toBe(true)
    expect(sectionHasEntry(text, 'operations', 'bar')).toBe(false)
    expect(sectionHasEntry(text, 'bindings', 'bar')).toBe(true)
  })

  it('inserts when the id exists only in another section', () => {
    const text = 'operations:\n  foo:\n    x: 1\nbindings:\n  bar:\n    y: 2\n'
    const next = insertSectionEntry(text, 'bindings', 'foo', '    z: 3\n')
    expect(sectionHasEntry(next, 'bindings', 'foo')).toBe(true)
    expect(sectionHasEntry(next, 'operations', 'foo')).toBe(true)
  })
})

describe('nextClientEmitOrder', () => {
  it('continues after the max client emitOrder', () => {
    expect(nextClientEmitOrder(undefined)).toBe(0)
    expect(
      nextClientEmitOrder({
        a: { artifact: 'client', emitOrder: 7 },
        b: { artifact: 'decisions', emitOrder: 99 },
        c: { artifact: 'client', emitOrder: 3 },
      }),
    ).toBe(8)
  })
})

describe('bindingStubFields', () => {
  it('builds a client wrap stub with split path refs', () => {
    const stub = bindingStubFields({
      id: 'getFoo',
      method: 'GET',
      routePath: '/v1/sdk/foo/{ref}',
      pathRefs: ['ref'],
      emitOrder: 4,
    })
    expect(stub.core).toBe('solvapay_transport::SolvaPayClient::get_foo')
    expect(stub.emitOrder).toBe(4)
    expect(stub.splitPathRefs).toEqual(['ref'])
    expect(stub.call).toEqual({ kind: 'wrap', serialize: 'clientSplit' })
    expect(stub.clientCallArgs).toEqual(['&refs[0]'])
  })
})
