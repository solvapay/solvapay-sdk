# Auth Package Analysis: Merge vs Rename vs Keep Separate

## Current State

### `@solvapay/auth` Package Contents

1. **Auth Adapters** (framework-agnostic):
   - `SupabaseAuthAdapter` - JWT validation (peer dep: `jose`)
   - `MockAuthAdapter` - Testing (no deps)
   - `AuthAdapter` interface

2. **Next.js Utilities** (Next.js-specific):
   - `requireUserId()` - Returns userId or Response
   - `getUserIdFromRequest()` - Gets from `x-user-id` header
   - `getUserEmailFromRequest()` - Extracts email from JWT
   - `getUserNameFromRequest()` - Extracts name from JWT

## Usage Analysis

### Where Auth Package is Used

- **Examples**: All checkout demos use `requireUserId`, `getUserEmailFromRequest`, `getUserNameFromRequest`
- **Server Package**: No direct usage (adapters are separate)
- **Next Package**: Dynamically imports from `@solvapay/auth` in `checkSubscription`

### Current Dependencies

```json
{
  "@solvapay/auth": {
    "peerDependencies": {
      "jose": "^5.0.0"  // Only needed for SupabaseAuthAdapter
    }
  }
}
```

## Options Analysis

### Option 1: Merge Everything into `@solvapay/server` ❌

**Structure:**
```
@solvapay/server/
  └── src/
      ├── auth/
      │   ├── adapters.ts      # SupabaseAuthAdapter, MockAuthAdapter
      │   └── next-utils.ts    # Next.js utilities
      └── ... (existing)
```

**Pros:**
- ✅ Fewer packages (4 instead of 5)
- ✅ All server-side code in one place
- ✅ Simpler dependency management

**Cons:**
- ❌ **Peer dependency issue**: Users would need `jose` even if they don't use Supabase
- ❌ Next.js utilities don't belong in generic server package
- ❌ Less modular - can't use auth adapters without server package
- ❌ Breaks separation of concerns

**Verdict:** ❌ Not recommended - peer dependency issue is a dealbreaker

### Option 2: Split Auth Package

**Structure A: Move Next.js utilities to `@solvapay/next`**

```
@solvapay/server/
  └── src/
      └── auth/
          ├── adapters.ts      # SupabaseAuthAdapter, MockAuthAdapter
          └── index.ts

@solvapay/next/
  └── src/
      ├── auth.ts              # requireUserId, getUserEmailFromRequest, etc.
      └── ... (existing)
```

**Pros:**
- ✅ Better logical grouping (Next.js utils in Next.js package)
- ✅ Users can use auth adapters without Next.js dependency
- ✅ No peer dependency bloat in server package

**Cons:**
- ⚠️ Breaking change - imports change from `@solvapay/auth` to `@solvapay/next` and `@solvapay/server/auth`
- ⚠️ Need to update all examples

**Verdict:** ✅ Good option, but requires migration

### Option 3: Rename to `@solvapay/server-auth` ✅ (Recommended)

**Structure:**
```
@solvapay/server-auth/  (renamed from @solvapay/auth)
  └── src/
      ├── adapters.ts      # SupabaseAuthAdapter, MockAuthAdapter
      ├── next-utils.ts    # Next.js utilities (or move to @solvapay/next)
      └── index.ts
```

**Pros:**
- ✅ Clearer naming - indicates it's server-side auth
- ✅ Groups with server package conceptually
- ✅ No breaking changes to functionality
- ✅ Can optionally move Next.js utils to `@solvapay/next` later

**Cons:**
- ⚠️ Still a breaking change (package rename)
- ⚠️ Still 5 packages (but better named)

**Verdict:** ✅ Recommended - best balance

### Option 4: Keep Separate, Move Next.js Utils ⚠️

**Structure:**
```
@solvapay/auth/  (keeps name)
  └── src/
      └── adapters.ts      # Only adapters

@solvapay/next/
  └── src/
      └── auth.ts          # Next.js utilities moved here
```

**Pros:**
- ✅ Better separation (adapters vs Next.js utils)
- ✅ No peer dependency bloat
- ✅ Next.js utilities in correct package

**Cons:**
- ⚠️ Breaking change for Next.js utilities (import path changes)
- ⚠️ Package name `@solvapay/auth` is generic (could be client-side)

**Verdict:** ⚠️ Good, but rename makes it clearer

## Recommended Approach: Hybrid

### Phase 1: Move Next.js Utilities to `@solvapay/next`

**Why:**
- Next.js utilities (`requireUserId`, `getUserEmailFromRequest`, etc.) are Next.js-specific
- They're already used primarily in Next.js contexts
- Better logical grouping

**Changes:**
```typescript
// Before
import { requireUserId } from '@solvapay/auth';

// After
import { requireUserId } from '@solvapay/next';
```

### Phase 2: Rename `@solvapay/auth` → `@solvapay/server-auth`

**Why:**
- Clearer indication it's server-side only
- Groups conceptually with `@solvapay/server`
- Better naming convention

**Changes:**
```typescript
// Before
import { SupabaseAuthAdapter } from '@solvapay/auth/supabase';

// After
import { SupabaseAuthAdapter } from '@solvapay/server-auth/supabase';
```

### Final Structure

```
@solvapay/server-auth/
  └── src/
      ├── adapters.ts      # SupabaseAuthAdapter, MockAuthAdapter
      └── index.ts

@solvapay/next/
  └── src/
      ├── auth.ts          # requireUserId, getUserEmailFromRequest, etc.
      ├── helpers/         # New route helpers
      └── index.ts
```

## Migration Strategy

### Step 1: Add Next.js utilities to `@solvapay/next`
- Move `next-utils.ts` from `@solvapay/auth` to `@solvapay/next/src/auth.ts`
- Export from `@solvapay/next` index
- Keep backward compatibility in `@solvapay/auth` (re-export with deprecation warning)

### Step 2: Update examples
- Change imports from `@solvapay/auth` to `@solvapay/next` for Next.js utilities
- Keep `@solvapay/auth` imports for adapters only

### Step 3: Rename package (major version)
- Rename `@solvapay/auth` → `@solvapay/server-auth`
- Update all imports
- Publish major version bump

### Step 4: Clean up
- Remove deprecated re-exports
- Update documentation

## Alternative: Keep Current Structure

**If we want to avoid breaking changes:**

- Keep `@solvapay/auth` as-is
- Move Next.js utilities to `@solvapay/next` with deprecation re-export
- Document that Next.js utilities should come from `@solvapay/next`

**Pros:**
- ✅ No breaking changes
- ✅ Better organization

**Cons:**
- ⚠️ Package name `@solvapay/auth` is ambiguous (could be client-side)

## Recommendation Summary

**Best Option: Hybrid Approach**

1. **Immediate**: Move Next.js utilities to `@solvapay/next`
   - Better logical grouping
   - No peer dependency issues
   - Can be done with deprecation warnings

2. **Future (v2.0)**: Rename `@solvapay/auth` → `@solvapay/server-auth`
   - Clearer naming
   - Better package organization
   - Breaking change (major version)

This gives us:
- ✅ Better organization (Next.js utils in Next.js package)
- ✅ Clearer naming (server-auth)
- ✅ No unnecessary peer dependencies
- ✅ Logical package boundaries

