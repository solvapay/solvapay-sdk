'use client'

/**
 * Re-export shim over the `ProductBadge` primitive. Kept at its historic
 * location so existing imports (`@solvapay/react` -> `ProductBadge`) keep
 * resolving. For full control, compose `@solvapay/react/primitives` directly.
 */

export { ProductBadge, PlanBadge } from '../primitives/ProductBadge'
