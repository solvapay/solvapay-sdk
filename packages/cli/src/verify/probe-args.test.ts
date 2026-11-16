import { describe, expect, it } from 'vitest'
import { probeArguments } from './probe-args'

describe('probeArguments', () => {
  it('fills required properties only', () => {
    expect(
      probeArguments({
        name: 'forecast',
        inputSchema: {
          type: 'object',
          properties: { city: { type: 'string' }, days: { type: 'integer' } },
          required: ['city'],
        },
      }),
    ).toEqual({ city: 'probe' })
  })

  it('returns no arguments for a tool without a schema or required properties', () => {
    expect(probeArguments({ name: 'list_cities' })).toEqual({})
    expect(probeArguments({ name: 'about', inputSchema: { type: 'object' } })).toEqual({})
  })

  it('picks a value each type and constraint accepts', () => {
    expect(
      probeArguments({
        name: 'everything',
        inputSchema: {
          type: 'object',
          properties: {
            count: { type: 'integer', minimum: 3 },
            above: { type: 'number', exclusiveMinimum: 0 },
            negative: { type: 'number', maximum: -1 },
            plain: { type: 'number' },
            flag: { type: 'boolean' },
            unit: { type: 'string', enum: ['c', 'f'] },
            fixed: { const: 'v1' },
            withDefault: { type: 'string', default: 'EUR' },
            email: { type: 'string', format: 'email' },
            since: { type: 'string', format: 'date' },
            code: { type: 'string', minLength: 8 },
            nullable: { type: ['null', 'string'] },
            tags: { type: 'array', items: { type: 'string' }, minItems: 2 },
            optionalList: { type: 'array', items: { type: 'string' } },
            address: {
              type: 'object',
              properties: { country: { type: 'string' }, zip: { type: 'string' } },
              required: ['country'],
            },
          },
          required: [
            'count',
            'above',
            'negative',
            'plain',
            'flag',
            'unit',
            'fixed',
            'withDefault',
            'email',
            'since',
            'code',
            'nullable',
            'tags',
            'optionalList',
            'address',
          ],
        },
      }),
    ).toEqual({
      count: 3,
      above: 1,
      negative: -1,
      plain: 1,
      flag: false,
      unit: 'c',
      fixed: 'v1',
      withDefault: 'EUR',
      email: 'probe@example.com',
      since: '2026-01-01',
      code: 'probexxx',
      nullable: 'probe',
      tags: ['probe', 'probe'],
      optionalList: [],
      address: { country: 'probe' },
    })
  })
})
