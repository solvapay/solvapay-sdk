import { z } from 'zod'

/**
 * Tool input schema for 64-bit integers (`format: int64`). JavaScript
 * numbers are only exact up to 2^53 - 1, so larger values travel as a
 * string of digits — the same form `upstreamFetchJson` returns them in.
 * Unsafe numbers are rejected instead of being silently rounded.
 */
export const int64 = z.union([
  z
    .number()
    .int()
    .refine(Number.isSafeInteger, 'Integers this large must be passed as a string of digits'),
  z.string().regex(/^-?\d+$/, 'Expected an integer as a string of digits'),
])
