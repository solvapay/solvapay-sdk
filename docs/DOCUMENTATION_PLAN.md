# SolvaPay SDK Documentation Plan

> **Note:** This is a strategic reference document. For the active working plan with current status and todos, see [DOCUMENTATION_BUILD_PLAN.md](./DOCUMENTATION_BUILD_PLAN.md).

## TLDR - Quick Overview

**What:** Set up unified documentation site at `docs.solvapay.com` for all SolvaPay SDKs (TypeScript, Python (later), etc.)

**How:** 
- **Central docs repo** (`solvapay-docs`) with Docusaurus
- **SDK-specific docs** stay in each SDK repo (`docs/` folder)
- **Git submodules** pull SDK docs into central site at build time
- **Auto-deploy** to Google Cloud Storage on every push

**Structure:**
```
docs.solvapay.com/
├── /getting-started (central docs)
├── /sdks/typescript (from TypeScript SDK repo)
├── /sdks/python (from Python SDK repo - later)
└── /guides (general guides)
```

**Benefits:**
- ✅ Unified site with search across all docs
- ✅ SDK teams maintain their own docs independently
- ✅ Automatic sync and deployment
- ✅ Professional, modern UI with Docusaurus

**Next Steps:**
1. Create `solvapay-docs` repository
2. Initialize Docusaurus
3. Add SDK repos as git submodules
4. Configure deployment workflow

See **Appendix A** for step-by-step setup instructions.

---

## Executive Summary

This plan outlines a comprehensive documentation strategy for the SolvaPay SDK, including API reference documentation, getting started guides, best practices, and code examples. The documentation will be automatically generated from TypeScript source code with JSDoc comments and deployed as a modern, searchable HTML site.

---

## 1. Documentation Tool Selection

### Recommended Solution: **TypeDoc + Docusaurus**

After evaluating modern documentation generators, we recommend a **hybrid approach**:

#### Primary Tool: **TypeDoc** (v0.25+)
- ✅ **TypeScript-native**: Specifically designed for TypeScript projects
- ✅ **JSDoc Integration**: Automatically extracts JSDoc comments from source code
- ✅ **Type Safety**: Shows accurate type information from TypeScript definitions
- ✅ **Modern Themes**: Supports custom themes (e.g., `typedoc-plugin-markdown`, `typedoc-vitepress-theme`)
- ✅ **CI/CD Ready**: Easy to integrate into build pipelines
- ✅ **Active Development**: Well-maintained with regular updates

#### Documentation Site Framework: **Docusaurus v3** (Optional but Recommended)
- ✅ **Modern UI**: Beautiful, responsive design out of the box
- ✅ **Search**: Built-in Algolia DocSearch integration
- ✅ **Versioning**: Support for multiple SDK versions
- ✅ **Guides + API**: Combine getting started guides with auto-generated API docs
- ✅ **TypeDoc Plugin**: `docusaurus-plugin-typedoc` for seamless integration
- ✅ **Markdown Support**: Easy to write guides and tutorials alongside API docs

**Alternative (Simpler)**: If you prefer a simpler setup, TypeDoc alone with a custom theme (like `typedoc-plugin-markdown` + static site generator) works great.

### Python SDK Documentation Tools

**Important Note:** TypeDoc is **TypeScript/JavaScript-specific** and does not support Python. For Python SDK documentation, use Python-native tools:

#### Recommended: **Sphinx** (for Python SDK)

**Why Sphinx:**
- ✅ **Python-native**: Standard tool for Python documentation (used by Python.org, Django, etc.)
- ✅ **Docstring Integration**: Automatically extracts docstrings from Python code
- ✅ **reStructuredText or Markdown**: Supports both formats
- ✅ **Rich Output**: HTML, PDF, ePub formats
- ✅ **Extensible**: Large plugin ecosystem
- ✅ **CI/CD Ready**: Easy to integrate into build pipelines

**Alternative: MkDocs** (Simpler option)
- ✅ **Markdown-based**: Easier to write than reStructuredText
- ✅ **Material theme**: Modern, beautiful default theme
- ✅ **Plugin support**: Extensible with plugins
- ✅ **Simpler setup**: Less configuration than Sphinx

**Integration with Docusaurus:**

Since Docusaurus accepts markdown files, Python docs can be integrated in two ways:

1. **Markdown Output**: Generate Python docs as markdown (Sphinx with markdown plugin, or MkDocs)
2. **HTML to Markdown**: Convert Sphinx HTML output to markdown for Docusaurus
3. **Direct Markdown**: Write Python API docs manually in markdown (simpler but less automated)

**Recommended Approach for Python:**
- Use **MkDocs** to generate markdown from Python docstrings
- Or use **Sphinx** with markdown support
- Output markdown files to `docs/` directory in Python SDK repo
- Docusaurus will automatically include them via git submodules

### Installation & Setup

```bash
# Core TypeDoc dependencies
pnpm add -D typedoc typedoc-plugin-markdown typedoc-plugin-param-names

# Optional: Docusaurus for full documentation site
pnpm add -D docusaurus @docusaurus/plugin-typedoc

# Or simpler: TypeDoc with Vitepress theme
pnpm add -D typedoc typedoc-vitepress-theme
```

---

## 2. Documentation Structure

### 2.1. Getting Started Guide

**Location**: `docs/getting-started.md` or `docs/getting-started/index.md`

**Sections**:
1. **Introduction**
   - What is SolvaPay SDK?
   - Key features and benefits
   - Use cases (API monetization, AI agents, MCP servers)

2. **Installation**
   - Prerequisites
   - Package installation (`@solvapay/server`, `@solvapay/react`, etc.)
   - Environment setup (API keys, environment variables)

3. **Quick Start Examples**
   - **Express.js**: Protect an API endpoint (5 minutes)
   - **Next.js**: Add payment flow to a Next.js app (10 minutes)
   - **MCP Server**: Protect MCP tools (5 minutes)
   - **React**: Add payment UI components (10 minutes)

4. **Core Concepts**
   - Agents and Plans
   - Customer references
   - Paywall protection flow
   - Subscription lifecycle

5. **Next Steps**
   - Link to full API reference
   - Link to examples
   - Link to architecture guide

### 2.2. API Reference Documentation

**Location**: Auto-generated from source code with TypeDoc

**Structure** (per package):

#### `@solvapay/server`
- **Main Exports**
  - `createSolvaPay(config?)` - Factory function
  - `createSolvaPayClient(options)` - Direct client creation
  - `verifyWebhook(options)` - Webhook verification
- **Types**
  - `SolvaPay` - Main instance interface
  - `PayableFunction` - Payable handler interface
  - `CreateSolvaPayConfig` - Configuration options
  - `PaywallError` - Error class
- **Adapters**
  - `payable().http()` - HTTP adapter (Express/Fastify)
  - `payable().next()` - Next.js adapter
  - `payable().mcp()` - MCP adapter
  - `payable().function()` - Pure function adapter
- **Methods**
  - `ensureCustomer()` - Ensure customer exists
  - `createPaymentIntent()` - Create payment intent
  - `processPayment()` - Process payment
  - `checkLimits()` - Check usage limits
  - `trackUsage()` - Track usage
  - `getCustomer()` - Get customer details
  - `createCheckoutSession()` - Create checkout session
  - `createCustomerSession()` - Create customer portal session

#### `@solvapay/react`
- **Components**
  - `SolvaPayProvider` - Context provider
  - `PaymentForm` - Payment form component
  - `PlanSelector` - Plan selection component
  - `SubscriptionGate` - Subscription gate component
  - `PlanBadge` - Plan badge component
  - `Spinner` - Loading spinner
  - `StripePaymentFormWrapper` - Stripe integration wrapper
- **Hooks**
  - `useSubscription()` - Get subscription status
  - `useSubscriptionStatus()` - Get subscription status details
  - `useCustomer()` - Get customer information
  - `useCheckout()` - Handle checkout flow
  - `usePlans()` - Get available plans
  - `useSolvaPay()` - Access SolvaPay context
- **Types**
  - `SolvaPayConfig` - Provider configuration
  - `SubscriptionStatus` - Subscription status type
  - `PaymentFormProps` - Payment form props
  - All component and hook types

#### `@solvapay/next`
- **Helpers**
  - `checkSubscription()` - Check subscription with caching
  - `syncCustomer()` - Sync customer data
  - `createPaymentIntent()` - Create payment intent
  - `processPayment()` - Process payment
  - `createCheckoutSession()` - Create hosted checkout
  - `createCustomerSession()` - Create customer portal
  - `cancelSubscription()` - Cancel subscription
  - `listPlans()` - List available plans
  - `getAuthenticatedUser()` - Get authenticated user
- **Cache Management**
  - `clearSubscriptionCache()` - Clear cache for user
  - `clearAllSubscriptionCache()` - Clear all cache
  - `getSubscriptionCacheStats()` - Get cache statistics
- **Middleware**
  - `createAuthMiddleware()` - Create auth middleware
  - `createSupabaseAuthMiddleware()` - Create Supabase auth middleware

#### `@solvapay/auth`
- **Adapters**
  - `MockAuthAdapter` - Mock adapter for testing
  - `SupabaseAuthAdapter` - Supabase adapter (from `@solvapay/auth/supabase`)
- **Utilities**
  - `getUserIdFromRequest()` - Extract user ID from request
  - `requireUserId()` - Require user ID or return error
  - `getUserEmailFromRequest()` - Extract email from Supabase JWT
  - `getUserNameFromRequest()` - Extract name from Supabase JWT

#### `@solvapay/react-supabase`
- **Exports**
  - `createSupabaseAuthAdapter()` - Create Supabase auth adapter

#### `@solvapay/core`
- **Types & Schemas**
  - All shared types and schemas
  - Error classes

### 2.3. Guides & Tutorials

**Location**: `docs/guides/` directory

1. **Server-Side Protection**
   - Express.js paywall protection
   - Next.js API route protection
   - MCP server integration
   - Edge runtime support
   - Webhook handling

2. **Client-Side Integration**
   - React component setup
   - Payment flow implementation
   - Subscription management UI
   - Supabase authentication integration

3. **Advanced Topics**
   - Custom authentication adapters
   - Request deduplication and caching
   - Error handling strategies
   - Testing with stub mode
   - Multi-tenant setups
   - Usage tracking and analytics

4. **Framework-Specific Guides**
   - Next.js App Router integration
   - Express.js middleware setup
   - Fastify integration
   - MCP server setup

### 2.4. Examples Documentation

**Location**: Enhanced examples with detailed READMEs

Each example should include:
- **Purpose**: What the example demonstrates
- **Setup Instructions**: Step-by-step setup
- **Key Features**: Highlighted features
- **Code Walkthrough**: Explanation of key code sections
- **Running the Example**: How to run and test

### 2.5. Best Practices

**Location**: `docs/best-practices.md`

Topics:
- Security best practices
- Performance optimization
- Error handling patterns
- Testing strategies
- Code organization
- TypeScript usage tips

---

## 3. Documentation Standards

### 3.1. JSDoc Comment Format

All exported functions, classes, and interfaces must include JSDoc comments with:

```typescript
/**
 * Brief description (one line)
 * 
 * Longer description if needed, explaining what the function does,
 * when to use it, and any important considerations.
 * 
 * @param paramName - Parameter description
 * @param options - Optional configuration object
 * @param options.key - Option key description
 * @returns Return value description
 * @throws {ErrorType} When and why this error is thrown
 * 
 * @example
 * ```typescript
 * // Simple example
 * const result = await myFunction('param');
 * ```
 * 
 * @example
 * ```typescript
 * // Advanced example with options
 * const result = await myFunction('param', {
 *   key: 'value'
 * });
 * ```
 * 
 * @see {@link RelatedFunction} for related functionality
 * @since 1.0.0
 */
```

### 3.2. Code Example Standards

All code examples should:
- ✅ Be **copy-paste ready** (no pseudo-code)
- ✅ Include **import statements**
- ✅ Show **error handling** where relevant
- ✅ Use **realistic variable names** (`agentRef`, `customerRef`, not `foo`, `bar`)
- ✅ Include **environment variable examples** where relevant
- ✅ Show **best practices** (not just "it works")
- ✅ Include **TypeScript types** explicitly when helpful
- ✅ Show **complete examples** (not just snippets where context is needed)

### 3.3. Documentation Metadata

Each package should have:
- **Package-level README** with overview and quick start
- **Version information** in generated docs
- **Changelog links** for version history
- **Migration guides** for breaking changes

---

## 4. Implementation Plan

### Phase 1: Foundation (Week 1-2)

1. **Setup Documentation Tooling**
   - [ ] Install TypeDoc and dependencies
   - [ ] Create TypeDoc configuration (`typedoc.json`)
   - [ ] Configure entry points for each package
   - [ ] Set up output directory structure
   - [ ] Test basic documentation generation

2. **Create Getting Started Guide**
   - [ ] Write introduction and overview
   - [ ] Create installation instructions
   - [ ] Write quick start examples (Express, Next.js, React, MCP)
   - [ ] Document core concepts
   - [ ] Add screenshots/diagrams where helpful

3. **Enhance Existing Code Comments**
   - [ ] Audit all exported functions/classes
   - [ ] Add JSDoc comments to main entry points
   - [ ] Add @param, @returns, @throws tags
   - [ ] Add @example blocks for key functions

### Phase 2: API Documentation (Week 3-4)

1. **Complete JSDoc Comments**
   - [ ] Add comprehensive JSDoc to `@solvapay/server`
   - [ ] Add comprehensive JSDoc to `@solvapay/react`
   - [ ] Add comprehensive JSDoc to `@solvapay/next`
   - [ ] Add comprehensive JSDoc to `@solvapay/auth`
   - [ ] Add comprehensive JSDoc to `@solvapay/react-supabase`
   - [ ] Add comprehensive JSDoc to `@solvapay/core`

2. **Generate and Review API Docs**
   - [ ] Generate initial documentation
   - [ ] Review for accuracy and completeness
   - [ ] Fix any TypeDoc configuration issues
   - [ ] Add missing examples
   - [ ] Improve descriptions

3. **Add Code Examples**
   - [ ] Create examples for all major functions
   - [ ] Add real-world use cases
   - [ ] Show error handling patterns
   - [ ] Demonstrate best practices

### Phase 3: Guides & Tutorials (Week 5-6)

1. **Write Framework Guides**
   - [ ] Express.js integration guide
   - [ ] Next.js integration guide
   - [ ] React integration guide
   - [ ] MCP server integration guide

2. **Write Advanced Guides**
   - [ ] Custom authentication adapters
   - [ ] Error handling strategies
   - [ ] Testing with stub mode
   - [ ] Performance optimization

3. **Enhance Example Documentation**
   - [ ] Add detailed READMEs to all examples
   - [ ] Create code walkthroughs
   - [ ] Add troubleshooting sections

### Phase 4: Polish & Deployment (Week 7-8)

1. **Documentation Site Setup** (Optional: Docusaurus)
   - [ ] Initialize Docusaurus site
   - [ ] Configure TypeDoc plugin
   - [ ] Set up navigation structure
   - [ ] Add search functionality
   - [ ] Configure versioning (if needed)
   - [ ] Customize theme and branding

2. **CI/CD Integration**
   - [ ] Add documentation build step to CI
   - [ ] Set up automated deployment
   - [ ] Configure preview deployments for PRs
   - [ ] Add documentation checks to PR validation

3. **Final Review**
   - [ ] Review all documentation for accuracy
   - [ ] Test all code examples
   - [ ] Check for broken links
   - [ ] Verify search functionality
   - [ ] Test on multiple devices/browsers

---

## 5. TypeDoc Configuration

### Basic Configuration (`typedoc.json`)

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": [
    "packages/server/src/index.ts",
    "packages/react/src/index.tsx",
    "packages/next/src/index.ts",
    "packages/auth/src/index.ts",
    "packages/react-supabase/src/index.ts",
    "packages/core/src/index.ts"
  ],
  "out": "docs/api",
  "readme": "README.md",
  "name": "SolvaPay SDK",
  "includeVersion": true,
  "excludePrivate": true,
  "excludeProtected": true,
  "excludeInternal": true,
  "excludeExternals": true,
  "categorizeByGroup": true,
  "categoryOrder": [
    "Core",
    "Server",
    "React",
    "Next.js",
    "Auth",
    "*"
  ],
  "plugin": [
    "typedoc-plugin-markdown",
    "typedoc-plugin-param-names"
  ],
  "theme": "default",
  "githubPages": false,
  "gitRevision": "main",
  "gitRemote": "origin"
}
```

### Package-Specific Configurations

For better organization, consider separate TypeDoc configs per package:

```json
// typedoc.server.json
{
  "entryPoints": ["packages/server/src/index.ts"],
  "out": "docs/api/server",
  "name": "@solvapay/server",
  "readme": "packages/server/README.md"
}
```

---

## 6. CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/docs.yml
name: Build Documentation

on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]

jobs:
  build-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9.6.0
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build packages
        run: pnpm build
      
      - name: Generate documentation
        run: pnpm docs:build
      
      - name: Deploy to GitHub Pages
        if: github.ref == 'refs/heads/main'
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs/api
```

### Package.json Scripts

```json
{
  "scripts": {
    "docs:build": "typedoc",
    "docs:watch": "typedoc --watch",
    "docs:serve": "serve docs/api",
    "docs:check": "typedoc --json docs/api.json && node scripts/validate-docs.js"
  }
}
```

---

## 7. Documentation Maintenance

### Regular Updates

- **After each release**: Review and update examples, check for breaking changes
- **Monthly**: Audit documentation for accuracy, update outdated examples
- **Quarterly**: Review documentation structure, add new guides based on user feedback

### Quality Checks

- **Automated**: TypeDoc validation, link checking, code example linting
- **Manual**: Peer review for new documentation, user feedback collection

### Versioning Strategy

- **Current version**: Always up-to-date with latest code
- **Previous versions**: Archive older versions if breaking changes occur
- **Preview versions**: Document preview features separately

---

## 8. Success Metrics

### Documentation Quality

- ✅ All exported functions have JSDoc comments
- ✅ All functions have at least one code example
- ✅ All examples are tested and working
- ✅ Documentation is searchable and navigable
- ✅ Getting started guide gets users productive in < 15 minutes

### Developer Experience

- ✅ Users can find information quickly (< 30 seconds)
- ✅ Code examples are copy-paste ready
- ✅ Documentation is accurate and up-to-date
- ✅ Search functionality works well
- ✅ Mobile-friendly design

---

## 9. Recommended Tools & Plugins

### TypeDoc Plugins

- `typedoc-plugin-markdown` - Generate Markdown output
- `typedoc-plugin-param-names` - Better parameter name extraction
- `typedoc-plugin-no-inherit` - Control inheritance display
- `typedoc-plugin-sourcefile-url` - Add source file links

### Documentation Site Options

1. **TypeDoc Default Theme** - Simple, fast, TypeScript-focused
2. **Docusaurus** - Full-featured docs site with search, versioning
3. **VitePress** - Fast, Vue-based docs site
4. **GitBook** - Modern docs platform (hosted option)

### Additional Tools

- **Link Checker**: `remark-cli` with `remark-lint` for markdown validation
- **Code Example Testing**: Automated tests for code examples
- **Spell Checker**: `cspell` for documentation spelling

---

## 10. Next Steps

### Immediate Actions

1. ✅ **Review this plan** with the team
2. ✅ **Choose documentation tool** (TypeDoc recommended)
3. ✅ **Set up TypeDoc configuration**
4. ✅ **Create getting started guide**
5. ✅ **Start adding JSDoc comments** to key functions

### Short-term (1-2 months)

- Complete JSDoc comments for all packages
- Generate initial API documentation
- Write framework-specific guides
- Set up CI/CD for documentation

### Long-term (3-6 months)

- Add interactive examples (CodeSandbox/StackBlitz)
- Create video tutorials
- Add internationalization (i18n) support
- Implement user feedback collection

---

## Appendix: Example JSDoc Comments

### Function Example

```typescript
/**
 * Create a SolvaPay instance with paywall protection capabilities.
 * 
 * This factory function creates a SolvaPay instance that can be used to
 * protect API endpoints, functions, and MCP tools with usage limits and
 * subscription checks.
 * 
 * @param config - Optional configuration object
 * @param config.apiKey - API key for production use (defaults to `SOLVAPAY_SECRET_KEY` env var)
 * @param config.apiClient - Custom API client for testing or advanced use cases
 * @param config.apiBaseUrl - Optional API base URL override
 * @returns SolvaPay instance with payable() method and API client access
 * 
 * @example
 * ```typescript
 * // Production: Use environment variable (recommended)
 * const solvaPay = createSolvaPay();
 * 
 * // Production: Pass API key explicitly
 * const solvaPay = createSolvaPay({
 *   apiKey: process.env.SOLVAPAY_SECRET_KEY
 * });
 * 
 * // Testing: Use mock client
 * const solvaPay = createSolvaPay({
 *   apiClient: mockClient
 * });
 * ```
 * 
 * @see {@link SolvaPay} for the returned instance interface
 * @see {@link CreateSolvaPayConfig} for configuration options
 * @since 1.0.0
 */
export function createSolvaPay(config?: CreateSolvaPayConfig): SolvaPay {
  // Implementation
}
```

### Component Example

```typescript
/**
 * Payment form component for handling Stripe checkout.
 * 
 * This component provides a complete payment form with Stripe integration,
 * including card input, plan selection, and payment processing. It handles
 * the entire checkout flow including payment intent creation and confirmation.
 * 
 * @example
 * ```tsx
 * import { PaymentForm } from '@solvapay/react';
 * 
 * function CheckoutPage() {
 *   return (
 *     <PaymentForm
 *       planRef="pln_premium"
 *       agentRef="agt_myapi"
 *       onSuccess={() => {
 *         console.log('Payment successful!');
 *         router.push('/dashboard');
 *       }}
 *       onError={(error) => {
 *         console.error('Payment failed:', error);
 *       }}
 *     />
 *   );
 * }
 * ```
 * 
 * @param props - Payment form configuration
 * @param props.planRef - Plan reference to subscribe to
 * @param props.agentRef - Agent reference for usage tracking
 * @param props.onSuccess - Callback when payment succeeds
 * @param props.onError - Callback when payment fails
 * @param props.showPlanDetails - Whether to show plan details (default: true)
 * 
 * @see {@link useCheckout} for programmatic checkout handling
 * @see {@link SolvaPayProvider} for required context provider
 */
export function PaymentForm(props: PaymentFormProps) {
  // Implementation
}
```

### Hook Example

```typescript
/**
 * Hook to get current subscription status and information.
 * 
 * Returns the current user's subscription status, including active
 * subscriptions, plan details, and payment information. Automatically
 * syncs with the SolvaPay backend and handles loading and error states.
 * 
 * @returns Subscription data and status
 * @returns subscriptions - Array of active subscriptions
 * @returns hasPaidSubscription - Whether user has any paid subscription
 * @returns isLoading - Loading state
 * @returns error - Error state if subscription check fails
 * 
 * @example
 * ```tsx
 * import { useSubscription } from '@solvapay/react';
 * 
 * function Dashboard() {
 *   const { subscriptions, hasPaidSubscription, isLoading } = useSubscription();
 * 
 *   if (isLoading) return <Spinner />;
 * 
 *   if (!hasPaidSubscription) {
 *     return <UpgradePrompt />;
 *   }
 * 
 *   return <PremiumContent subscriptions={subscriptions} />;
 * }
 * ```
 * 
 * @see {@link SolvaPayProvider} for required context provider
 * @see {@link useSubscriptionStatus} for detailed status information
 */
export function useSubscription(): UseSubscriptionReturn {
  // Implementation
}
```

---

## 11. Multi-Repo Documentation Strategy

### Overview

SolvaPay will have multiple SDK repositories (TypeScript, Python (later), etc.) plus a frontend repository. This section outlines how to organize documentation across multiple repositories while maintaining a unified documentation site at `docs.solvapay.com`.

### Repository Structure

```
solvapay-org/
├── solvapay-docs/              # Central documentation repo
│   ├── docs-site/              # Docusaurus site
│   └── docs/                   # General documentation
├── solvapay-sdk/    # TypeScript SDK repo
│   ├── docs/                   # TypeScript-specific docs
│   └── README.md               # SDK overview
├── solvapay-sdk-python/        # Python SDK repo (later)
│   ├── docs/                   # Python-specific docs
│   └── README.md               # SDK overview
└── solvapay-frontend/          # Frontend repo
    └── docs/                   # Frontend-specific docs
```

### Recommended Approach: Central Docs Repo + Git Submodules

**Best Solution: Docusaurus with Git Submodules**

This approach:
- ✅ **Centralized control** - All docs in one place for deployment
- ✅ **SDK-specific docs** stay in their repos (maintained by SDK teams)
- ✅ **Automatic sync** - Pull latest from each SDK repo at build time
- ✅ **Unified site** - Single docs.solvapay.com with seamless navigation
- ✅ **Version control** - Each SDK repo manages its own docs

### Implementation Strategy

#### Option 1: Git Submodules (Recommended)

**How it works:**
1. Central `solvapay-docs` repo contains the Docusaurus site
2. SDK repos are added as git submodules
3. Build process pulls latest docs from each SDK repo
4. Docusaurus combines everything into one site

**Setup Steps:**

1. **Create Central Docs Repo:**
   ```bash
   # Create new repo: solvapay-docs
   mkdir solvapay-docs
   cd solvapay-docs
   npx create-docusaurus@latest docs-site classic --typescript
   ```

2. **Add SDK Repos as Submodules:**
   ```bash
   cd solvapay-docs
   
   # Add TypeScript SDK as submodule
   git submodule add https://github.com/solvapay/solvapay-sdk.git sdks/typescript
   
   # Add Python SDK as submodule
   git submodule add https://github.com/solvapay/solvapay-sdk-python.git sdks/python
   
   # Add Frontend as submodule (if needed)
   git submodule add https://github.com/solvapay/solvapay-frontend.git frontend
   ```

3. **Configure Docusaurus to Use Multiple Docs Directories:**

   Update `docusaurus.config.ts`:
   ```typescript
   import type {Config} from '@docusaurus/types';
   import type * as Preset from '@docusaurus/preset-classic';

   const config: Config = {
     title: 'SolvaPay Documentation',
     tagline: 'Monetize your AI agents and APIs',
     url: 'https://docs.solvapay.com',
     baseUrl: '/',
     
     presets: [
       [
         'classic',
         {
           docs: {
             // Main docs from central repo
             path: 'docs',
             sidebarPath: './sidebars.ts',
             editUrl: 'https://github.com/solvapay/solvapay-docs/tree/main/',
           },
           blog: false,
           theme: {
             customCss: './src/css/custom.css',
           },
         } satisfies Preset.Options,
       ],
     ],
     
     plugins: [
       // TypeScript SDK docs
       [
         '@docusaurus/plugin-content-docs',
         {
           id: 'typescript-sdk',
           path: 'sdks/typescript/docs',
           routeBasePath: 'sdks/typescript',
           sidebarPath: './sidebars-typescript.ts',
           editUrl: 'https://github.com/solvapay/solvapay-sdk/tree/main/docs/',
         },
       ],
       // Python SDK docs (later)
       // [
       //   '@docusaurus/plugin-content-docs',
       //   {
       //     id: 'python-sdk',
       //     path: 'sdks/python/docs',
       //     routeBasePath: 'sdks/python',
       //     sidebarPath: './sidebars-python.ts',
       //     editUrl: 'https://github.com/solvapay/solvapay-sdk-python/tree/main/docs/',
       //   },
       // ],
       // Frontend docs (if needed)
       [
         '@docusaurus/plugin-content-docs',
         {
           id: 'frontend',
           path: 'frontend/docs',
           routeBasePath: 'frontend',
           sidebarPath: './sidebars-frontend.ts',
           editUrl: 'https://github.com/solvapay/solvapay-frontend/tree/main/docs/',
         },
       ],
     ],
     
     themeConfig: {
       navbar: {
         title: 'SolvaPay Docs',
         items: [
           {
             type: 'docSidebar',
             sidebarId: 'tutorialSidebar',
             label: 'Getting Started',
             position: 'left',
           },
           {
             label: 'TypeScript SDK',
             type: 'docSidebar',
             sidebarId: 'typescriptSidebar',
             position: 'left',
           },
           // {
           //   label: 'Python SDK',
           //   type: 'docSidebar',
           //   sidebarId: 'pythonSidebar',
           //   position: 'left',
           // }, // (later)
           {
             type: 'dropdown',
             label: 'More',
             position: 'right',
             items: [
               {
                 label: 'GitHub',
                 href: 'https://github.com/solvapay',
               },
               {
                 label: 'Dashboard',
                 href: 'https://app.solvapay.com',
               },
             ],
           },
         ],
       },
     },
   };

   export default config;
   ```

4. **Create Sidebar Configurations:**

   `sidebars.ts` (main docs):
   ```typescript
   import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

   const sidebars: SidebarsConfig = {
     tutorialSidebar: [
       'getting-started',
       {
         type: 'category',
         label: 'Getting Started',
         items: [
           'getting-started/introduction',
           'getting-started/dashboard-setup',
           'getting-started/installation',
         ],
       },
       {
         type: 'category',
         label: 'SDKs',
         items: [
           {
             type: 'link',
             label: 'TypeScript SDK',
             href: '/sdks/typescript/intro',
           },
           // {
           //   type: 'link',
           //   label: 'Python SDK',
           //   href: '/sdks/python/intro',
           // }, // (later)
         ],
       },
     ],
   };

   export default sidebars;
   ```

   `sidebars-typescript.ts`:
   ```typescript
   import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

   const sidebars: SidebarsConfig = {
     typescriptSidebar: [
       'intro',
       'installation',
       'quick-start',
       {
         type: 'category',
         label: 'API Reference',
         items: [
           'api-reference/server',
           'api-reference/react',
           'api-reference/next',
         ],
       },
     ],
   };

   export default sidebars;
   ```

   `sidebars-python.ts` (later):
   ```typescript
   // Python SDK sidebar configuration (to be added later)
   ```

5. **Build Script with Submodule Update:**

   Add to `package.json` in docs repo:
   ```json
   {
     "scripts": {
       "docs:update-submodules": "git submodule update --remote --merge",
       "docs:build": "npm run docs:update-submodules && cd docs-site && npm run build",
       "docs:dev": "cd docs-site && npm run start"
     }
   }
   ```

#### Option 2: GitHub API / Build-Time Fetch (Alternative)

**How it works:**
1. Central docs repo contains Docusaurus site
2. Build script fetches docs from SDK repos via GitHub API
3. Docs are cached locally during build
4. No submodules needed

**Setup:**

Create `scripts/fetch-sdk-docs.js`:
```javascript
const fs = require('fs');
const path = require('path');
const https = require('https');

async function fetchFromGitHub(owner, repo, path, branch = 'main') {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  // Fetch TypeScript SDK docs
  const tsDocs = await fetchFromGitHub('solvapay', 'solvapay-sdk', 'docs');
  fs.mkdirSync('docs-site/sdks/typescript/docs', { recursive: true });
  // Process and save docs...
  
  // Fetch Python SDK docs (later)
  // const pythonDocs = await fetchFromGitHub('solvapay', 'solvapay-sdk-python', 'docs');
  // fs.mkdirSync('docs-site/sdks/python/docs', { recursive: true });
  // Process and save docs...
}

main();
```

**Pros:**
- ✅ No submodule management
- ✅ Always gets latest from main branch
- ✅ Simpler git workflow

**Cons:**
- ❌ Requires GitHub API access
- ❌ More complex build process
- ❌ No version pinning

#### Option 3: Monorepo with Workspace (If Consolidating)

If you want to consolidate repos into a monorepo:

```
solvapay-monorepo/
├── docs-site/              # Docusaurus site
├── sdks/
│   ├── typescript/
│   │   └── docs/
│   └── python/
│       └── docs/
└── frontend/
    └── docs/
```

**Pros:**
- ✅ Everything in one place
- ✅ Easier cross-repo linking
- ✅ Single build process

**Cons:**
- ❌ Requires repo consolidation
- ❌ Larger repository
- ❌ More complex permissions

### Recommended Structure for Each SDK Repo

**TypeScript SDK Structure:**

```
solvapay-sdk/
├── README.md                    # Overview, quick start, badges
├── docs/
│   ├── intro.md                 # SDK introduction
│   ├── installation.md          # Installation instructions
│   ├── quick-start.md           # Quick start guide
│   ├── api-reference/           # API reference (auto-generated via TypeDoc)
│   │   ├── server.md
│   │   ├── react.md
│   │   └── next.md
│   ├── guides/                  # Framework-specific guides
│   │   ├── express.md
│   │   ├── nextjs.md
│   │   └── mcp.md
│   └── examples/                # Code examples
│       └── examples.md
└── package.json
```

**Python SDK Structure (later):**

```
solvapay-sdk-python/
├── README.md                    # Overview, quick start, badges
├── docs/
│   ├── intro.md                 # SDK introduction
│   ├── installation.md          # Installation instructions
│   ├── quick-start.md           # Quick start guide
│   ├── api-reference/           # API reference (auto-generated via Sphinx/MkDocs)
│   │   ├── client.md
│   │   ├── paywall.md
│   │   └── helpers.md
│   ├── guides/                  # Framework-specific guides
│   │   ├── flask.md
│   │   ├── fastapi.md
│   │   └── django.md
│   └── examples/                # Code examples
│       └── examples.md
├── mkdocs.yml                   # MkDocs configuration (if using MkDocs)
└── pyproject.toml               # Python project config
```

**Python Documentation Generation:**

For Python SDK, you can use:

1. **MkDocs** (Recommended for simplicity):
   ```bash
   # In Python SDK repo
   pip install mkdocs mkdocs-material mkdocstrings[python]
   
   # Generate markdown from docstrings
   mkdocs build --site-dir docs/api-reference
   ```

2. **Sphinx** (More powerful, standard for Python):
   ```bash
   # In Python SDK repo
   pip install sphinx sphinx-rtd-theme myst-parser
   
   # Generate markdown from docstrings
   sphinx-build -b markdown docs/source docs/api-reference
   ```

3. **Manual Markdown** (Simplest, but requires manual updates):
   - Write API reference manually in markdown
   - Update when code changes
   - Good for small APIs or when you want full control

### Linking Strategy

**Between Central Docs and SDK Docs:**

In central docs (`docs/getting-started/installation.md`):
```markdown
# SDK Installation

Choose your language:

- [TypeScript SDK](/sdks/typescript/installation) - For Node.js, Next.js, React
- [Python SDK](/sdks/python/installation) - For Python applications (later)
```

**Between SDK Docs:**

In TypeScript SDK docs (`docs/guides/nextjs.md`):
```markdown
# Next.js Integration

See also:
- [React Components](/sdks/typescript/api-reference/react)
- [Next.js Helpers](/sdks/typescript/api-reference/next)
```

**Cross-SDK References:**

```markdown
# Authentication

The authentication flow is similar across all SDKs:
- TypeScript: See [TypeScript Auth Guide](/sdks/typescript/guides/authentication)
- Python: See [Python Auth Guide](/sdks/python/guides/authentication) (later)
```

### Deployment Workflow

**GitHub Actions Workflow** (`.github/workflows/deploy-docs.yml`):

```yaml
name: Deploy Documentation

on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - 'docs-site/**'
  workflow_dispatch:
  # Trigger on SDK repo updates (via webhook or scheduled)
  schedule:
    - cron: '0 * * * *'  # Check hourly for SDK updates

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive
          token: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Update Submodules
        run: |
          git submodule update --remote --merge
          git submodule foreach 'git checkout main || git checkout master'
      
      - name: Install Dependencies
        run: |
          cd docs-site
          npm install
      
      - name: Build Documentation
        run: |
          cd docs-site
          npm run build
        env:
          # Build TypeScript SDK docs (if needed)
          BUILD_TSDOC: true
      
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      
      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2
      
      - name: Deploy to Google Cloud Storage
        run: |
          gsutil -m rsync -r -d docs-site/build gs://${{ secrets.GCS_BUCKET_NAME }}
          gsutil web set -m index.html -e 404.html gs://${{ secrets.GCS_BUCKET_NAME }}
          gcloud compute url-maps invalidate-cdn-cache ${{ secrets.CDN_URL_MAP }} --path="/*"
```

### Auto-Sync Strategy

**Option 1: Scheduled Updates (Recommended)**
- GitHub Actions runs hourly/daily
- Updates submodules to latest
- Rebuilds and deploys if changes detected

**Option 2: Webhook Triggers**
- Each SDK repo sends webhook on docs update
- Central docs repo rebuilds automatically
- More responsive but requires webhook setup

**Option 3: Manual Sync**
- Update submodules before deploying
- Full control over when docs update
- Good for versioned releases

### Versioning Strategy

**For SDK-Specific Docs:**

Each SDK can version its docs independently:

```
sdks/typescript/
├── versioned_docs/
│   ├── version-1.0/
│   │   └── docs/
│   └── version-2.0/
│       └── docs/
└── docs/  # Latest version
```

Docusaurus supports this natively with versioning plugin.

**For Central Docs:**

Central docs (getting started, dashboard setup) are always latest - no versioning needed.

### Search Configuration

With multiple doc instances, configure Algolia DocSearch to index all:

```javascript
// docusaurus.config.ts
algolia: {
  appId: 'YOUR_APP_ID',
  apiKey: 'YOUR_API_KEY',
  indexName: 'solvapay-docs',
  contextualSearch: true,
  searchParameters: {
    facetFilters: [
      ['language:typescript', 'language:python'], // python later
    ],
  },
},
```

### Best Practices

1. **Consistent Structure**: Use same doc structure across all SDK repos
2. **Cross-Linking**: Link between SDK docs and central docs
3. **Version Pinning**: Pin submodule versions for stable releases
4. **Build Caching**: Cache SDK builds to speed up doc generation
5. **Preview Deployments**: Test doc changes before merging
6. **Automated Checks**: Validate links and markdown on PR

### Recommended Final Structure

```
docs.solvapay.com/
├── / (Homepage)
├── /getting-started
│   ├── /introduction
│   ├── /dashboard-setup
│   └── /installation (links to SDK-specific installs)
├── /sdks/typescript
│   ├── /intro
│   ├── /installation
│   ├── /quick-start
│   ├── /api-reference
│   └── /guides
├── /sdks/python
│   ├── /intro
│   ├── /installation
│   ├── /quick-start
│   ├── /api-reference
│   └── /guides
├── /guides (general guides)
└── /examples (cross-SDK examples)
```

---

## 12. Documentation Publishing & Deployment Strategy

### Overview

This section outlines how to publish and deploy the SolvaPay SDK documentation to `docs.solvapay.com` with proper organization, hosting, and integration with the SDK build process.

### Domain Structure (Multi-Repo)

The documentation will be organized under `docs.solvapay.com` with the following hierarchy (see Section 11 for multi-repo setup):

```
docs.solvapay.com/
├── / (Homepage - Overview & Quick Links)
├── /getting-started
│   ├── /introduction (General introduction)
│   ├── /dashboard-setup (Setting up account in dashboard)
│   └── /installation (Links to SDK-specific installations)
├── /sdks/typescript
│   ├── /intro
│   ├── /installation
│   ├── /quick-start
│   ├── /api-reference
│   │   ├── /server
│   │   ├── /react
│   │   ├── /next
│   │   └── /auth
│   ├── /guides
│   └── /examples
├── /sdks/python (later)
│   ├── /intro
│   ├── /installation
│   ├── /quick-start
│   ├── /api-reference
│   ├── /guides
│   └── /examples
├── /guides (General guides)
└── /examples (Cross-SDK examples)
```

**Note:** This structure supports multiple SDK repositories. Each SDK has its own documentation section while maintaining a unified site. See Section 11 for implementation details.

### Recommended Solution: Docusaurus + Custom Domain Deployment

**Why Docusaurus:**
- ✅ **Modern, professional UI** out of the box
- ✅ **Built-in search** (Algolia DocSearch integration available)
- ✅ **Versioning support** for multiple SDK versions
- ✅ **TypeDoc integration** via `docusaurus-plugin-typedoc`
- ✅ **Markdown + MDX** for flexible content
- ✅ **Easy deployment** to Google Cloud Storage, Cloud Run, or custom hosting
- ✅ **Active community** and excellent documentation

**Why NOT GitHub Pages alone:**
- ❌ Limited customization for custom domains
- ❌ Less control over deployment process
- ❌ Harder to integrate with SDK build pipeline
- ❌ Limited CI/CD integration options

**Recommended: Docusaurus + Google Cloud Storage + Cloud CDN**

### Option 1: Docusaurus + Google Cloud Storage + Cloud CDN (Recommended)

**Pros:**
- ✅ **Automatic deployments** from GitHub Actions
- ✅ **Custom domain** support (docs.solvapay.com)
- ✅ **Fast CDN** globally distributed via Cloud CDN
- ✅ **Cost-effective** pay-as-you-go pricing
- ✅ **Easy SSL** certificate management via Cloud Load Balancer
- ✅ **Integrates with SDK build** process seamlessly
- ✅ **Versioning support** via Cloud Storage versioning

**Setup Steps:**

1. **Initialize Docusaurus in the SDK repo:**
   ```bash
   cd /Users/tommy/projects/solvapay/solvapay-sdk
   npx create-docusaurus@latest docs-site classic --typescript
   ```

2. **Configure Docusaurus** (`docs-site/docusaurus.config.ts`):
   ```typescript
   import {themes as prismThemes} from 'prism-react-renderer';
   import type {Config} from '@docusaurus/types';
   import type * as Preset from '@docusaurus/preset-classic';
   import typedocPlugin from 'docusaurus-plugin-typedoc';

   const config: Config = {
     title: 'SolvaPay SDK',
     tagline: 'Monetize your AI agents and APIs',
     favicon: 'img/favicon.ico',
     url: 'https://docs.solvapay.com',
     baseUrl: '/',
     organizationName: 'solvapay',
     projectName: 'solvapay-sdk',
     onBrokenLinks: 'throw',
     onBrokenMarkdownLinks: 'warn',
     i18n: {
       defaultLocale: 'en',
       locales: ['en'],
     },
     presets: [
       [
         'classic',
         {
           docs: {
             sidebarPath: './sidebars.ts',
             editUrl: 'https://github.com/solvapay/solvapay-sdk/tree/main/docs/',
           },
           blog: false,
           theme: {
             customCss: './src/css/custom.css',
           },
         } satisfies Preset.Options,
       ],
     ],
     plugins: [
       [
         typedocPlugin,
         {
           id: 'api-reference',
           entryPoints: [
             '../packages/server/src/index.ts',
             '../packages/react/src/index.tsx',
             '../packages/next/src/index.ts',
             '../packages/auth/src/index.ts',
           ],
           tsconfig: '../tsconfig.base.json',
           out: 'api-reference',
           sidebar: {
             fullNames: false,
             categoryLabel: 'API Reference',
           },
         },
       ],
     ],
     themeConfig: {
       navbar: {
         title: 'SolvaPay SDK',
         logo: {
           alt: 'SolvaPay Logo',
           src: 'img/logo.svg',
         },
         items: [
           {
             type: 'docSidebar',
             sidebarId: 'tutorialSidebar',
             position: 'left',
             label: 'Docs',
           },
           {
             to: '/api-reference',
             label: 'API Reference',
             position: 'left',
           },
           {
             href: 'https://solvapay.com',
             label: 'Home',
             position: 'right',
           },
           {
             href: 'https://app.solvapay.com',
             label: 'Dashboard',
             position: 'right',
           },
           {
             href: 'https://github.com/solvapay/solvapay-sdk',
             label: 'GitHub',
             position: 'right',
           },
         ],
       },
       footer: {
         style: 'dark',
         links: [
           {
             title: 'Docs',
             items: [
               {
                 label: 'Getting Started',
                 to: '/getting-started',
               },
               {
                 label: 'API Reference',
                 to: '/api-reference',
               },
             ],
           },
           {
             title: 'Community',
             items: [
               {
                 label: 'GitHub',
                 href: 'https://github.com/solvapay/solvapay-sdk',
               },
             ],
           },
           {
             title: 'More',
             items: [
               {
                 label: 'SolvaPay Home',
                 href: 'https://solvapay.com',
               },
               {
                 label: 'Dashboard',
                 href: 'https://app.solvapay.com',
               },
             ],
           },
         ],
         copyright: `Copyright © ${new Date().getFullYear()} SolvaPay.`,
       },
       prism: {
         theme: prismThemes.github,
         darkTheme: prismThemes.dracula,
         additionalLanguages: ['bash', 'json', 'typescript'],
       },
     } satisfies Preset.ThemeConfig,
   };

   export default config;
   ```

3. **Create Sidebar Configuration** (`docs-site/sidebars.ts`):
   ```typescript
   import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

   const sidebars: SidebarsConfig = {
     tutorialSidebar: [
       'getting-started',
       {
         type: 'category',
         label: 'Getting Started',
         items: [
           'getting-started/introduction',
           'getting-started/dashboard-setup',
           'getting-started/installation',
         ],
       },
       {
         type: 'category',
         label: 'Guides',
         items: [
           'guides/server-side-protection',
           'guides/client-side-integration',
           'guides/advanced-topics',
         ],
       },
       {
         type: 'category',
         label: 'API Reference',
         items: [
           'api-reference/server',
           'api-reference/react',
           'api-reference/next',
           'api-reference/auth',
           'api-reference/backend-routes',
         ],
       },
       {
         type: 'category',
         label: 'Examples',
         items: [
           'examples/overview',
           'examples/express-basic',
           'examples/nextjs-checkout',
           'examples/mcp-basic',
         ],
       },
     ],
   };

   export default sidebars;
   ```

4. **Add Build Scripts** to root `package.json`:
   ```json
   {
     "scripts": {
       "docs:build": "cd docs-site && npm run build",
       "docs:dev": "cd docs-site && npm run start",
       "docs:serve": "cd docs-site && npm run serve"
     }
   }
   ```

5. **Deploy to Google Cloud Storage:**
   - Create GCS bucket for static site hosting
   - Configure bucket for website hosting
   - Set up Cloud CDN for global distribution
   - Configure Cloud Load Balancer with SSL certificate
   - Add custom domain: `docs.solvapay.com`
   - Configure DNS: Add A record pointing to load balancer IP

### Option 2: Docusaurus + Google Cloud Run (Alternative)

**Pros:**
- ✅ **Container-based** deployment
- ✅ **Automatic scaling** based on traffic
- ✅ **Custom domain** support
- ✅ **Integrated** with Google Cloud ecosystem

**Cons:**
- ❌ **More complex** setup than static hosting
- ❌ **Higher cost** for low traffic (minimum instances)
- ❌ **Overkill** for static sites (better for dynamic content)

**Setup Steps:**

1. **Follow Docusaurus setup** (same as Option 1)

2. **Add GitHub Actions Workflow** (`.github/workflows/docs.yml`):
   ```yaml
   name: Deploy Documentation

   on:
     push:
       branches:
         - main
         - dev
       paths:
         - 'docs/**'
         - 'docs-site/**'
         - 'packages/**/src/**'
     workflow_dispatch:

   jobs:
     deploy:
       runs-on: ubuntu-latest
       permissions:
         contents: read
         pages: write
         id-token: write
       steps:
         - uses: actions/checkout@v4
         
         - name: Setup Node.js
           uses: actions/setup-node@v4
           with:
             node-version: '20'
             cache: 'pnpm'
         
         - name: Install pnpm
           uses: pnpm/action-setup@v2
           with:
             version: 9.6.0
         
         - name: Install dependencies
           run: pnpm install --frozen-lockfile
         
         - name: Build packages
           run: pnpm build:packages
         
         - name: Setup Pages
           uses: actions/configure-pages@v4
         
         - name: Build documentation
           run: |
             cd docs-site
             npm install
             npm run build
         
         - name: Upload artifact
           uses: actions/upload-pages-artifact@v3
           with:
             path: docs-site/build
         
         - name: Deploy to GitHub Pages
           id: deployment
           uses: actions/deploy-pages@v4
   ```

3. **Configure Custom Domain:**
   - In GitHub repo: Settings → Pages → Custom domain → `docs.solvapay.com`
   - Add CNAME file to `docs-site/static/CNAME` with content: `docs.solvapay.com`
   - Configure DNS: Add CNAME record pointing to GitHub Pages

### Option 3: Docusaurus + Firebase Hosting (Alternative)

Firebase Hosting is Google's managed static hosting service. Good alternative if you want a simpler setup than GCS + CDN.

**Pros:**
- ✅ **Simple setup** via Firebase CLI
- ✅ **Automatic SSL** certificates
- ✅ **Fast CDN** included
- ✅ **Free tier** available

**Cons:**
- ❌ **Less control** than GCS + CDN
- ❌ **Firebase-specific** (not pure GCP)

### Documenting Backend SDK Routes

The backend SDK routes (`/v1/sdk/*`) are already defined in `packages/server/src/types/generated.ts` from the OpenAPI spec. To document them:

1. **Create Backend Routes Documentation** (`docs-site/docs/api-reference/backend-routes.md`):
   ```markdown
   # Backend SDK Routes

   The SolvaPay backend provides REST API endpoints for SDK operations. All routes are prefixed with `/v1/sdk/`.

   ## Authentication

   All requests require authentication via Bearer token in the Authorization header:
   ```
   Authorization: Bearer YOUR_API_KEY
   ```

   ## Base URL

   - **Development**: `https://api-dev.solvapay.com`
   - **Production**: `https://api.solvapay.com`

   ## Endpoints

   ### Limits

   #### POST /v1/sdk/limits

   Check usage limits for a customer.

   [Auto-generated from OpenAPI spec using TypeDoc]
   ```

2. **Generate OpenAPI Documentation:**
   - Use `redoc-cli` or `swagger-ui` to generate interactive API docs
   - Embed in Docusaurus using iframe or React component
   - Or use `docusaurus-plugin-openapi` to auto-generate from OpenAPI spec

3. **Add OpenAPI Plugin to Docusaurus:**
   ```typescript
   // docusaurus.config.ts
   plugins: [
     [
       'docusaurus-plugin-openapi',
       {
         id: 'backend-api',
         specPath: '../packages/server/src/types/openapi.json', // Generate from backend
         routeBasePath: '/api-reference/backend-routes',
       },
     ],
   ],
   ```

### Integration with SDK Build Process

**Option A: Separate Documentation Build (Recommended)**

Documentation builds independently from SDK packages:

1. **Documentation changes** trigger docs deployment
2. **SDK package changes** trigger docs rebuild (to update API reference)
3. **Both can deploy** independently

**GitHub Actions Workflow:**
```yaml
name: Build and Deploy Documentation

on:
  push:
    branches: [main, dev]
    paths:
      - 'docs/**'
      - 'docs-site/**'
      - 'packages/**/src/**'  # Rebuild docs when SDK code changes
  pull_request:
    branches: [main, dev]

jobs:
  build-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      
      - name: Install pnpm
        uses: pnpm/action-setup@v2
        with:
          version: 9.6.0
      
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      
      - name: Build SDK packages
        run: pnpm build:packages
      
      - name: Generate TypeDoc documentation
        run: pnpm docs:build
      
      - name: Build Docusaurus site
        run: |
          cd docs-site
          npm install
          npm run build
      
      - name: Authenticate to Google Cloud
        if: github.ref == 'refs/heads/main'
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}
      
      - name: Set up Cloud SDK
        if: github.ref == 'refs/heads/main'
        uses: google-github-actions/setup-gcloud@v2
      
      - name: Deploy to Google Cloud Storage
        if: github.ref == 'refs/heads/main'
        run: |
          gsutil -m rsync -r -d docs-site/build gs://${{ secrets.GCS_BUCKET_NAME }}
          gsutil web set -m index.html -e 404.html gs://${{ secrets.GCS_BUCKET_NAME }}
          gcloud compute url-maps invalidate-cdn-cache ${{ secrets.CDN_URL_MAP }} --path="/*"
```

**Option B: Integrated Build (Alternative)**

Documentation builds as part of SDK release process:

1. **On SDK release**, build docs and deploy
2. **Version docs** with SDK versions
3. **Single deployment** per release

### Documentation Structure in Repository

```
solvapay-sdk/
├── docs/                          # Source markdown files
│   ├── getting-started/
│   │   ├── introduction.md
│   │   ├── dashboard-setup.md
│   │   └── installation.md
│   ├── guides/
│   │   ├── server-side-protection.md
│   │   ├── client-side-integration.md
│   │   └── advanced-topics.md
│   ├── api-reference/
│   │   └── backend-routes.md      # Manual docs for /v1/sdk/* routes
│   └── examples/
│       └── overview.md
├── docs-site/                     # Docusaurus site
│   ├── docusaurus.config.ts
│   ├── sidebars.ts
│   ├── src/
│   │   ├── css/
│   │   └── pages/
│   └── static/
│       └── CNAME                  # For custom domain
└── packages/
    └── server/
        └── src/
            └── types/
                └── generated.ts   # Auto-generated from OpenAPI
```

### Deployment Workflow

**Recommended Workflow:**

1. **Development:**
   - Write docs in `docs/` directory (markdown)
   - Run `pnpm docs:dev` to preview locally
   - Commit changes to `dev` branch

2. **Preview Deployment:**
   - Push to `dev` → GitHub Actions builds and deploys to preview bucket
   - Preview URL: `docs-dev.solvapay.com` or preview GCS bucket URL
   - Review changes before merging

3. **Production Deployment:**
   - Merge `dev` → `main`
   - GitHub Actions builds docs (includes latest SDK code)
   - Deploys to production GCS bucket
   - Cloud CDN invalidates cache automatically
   - Updates live at `docs.solvapay.com`
   - Updates API reference from latest TypeDoc generation

### Custom Domain Setup (docs.solvapay.com)

**For Google Cloud Storage + Cloud CDN:**

1. **Create GCS Bucket:**
   ```bash
   gsutil mb -p PROJECT_ID -c STANDARD -l US-CENTRAL1 gs://docs-solvapay-com
   ```

2. **Configure Bucket for Website Hosting:**
   ```bash
   gsutil web set -m index.html -e 404.html gs://docs-solvapay-com
   gsutil iam ch allUsers:objectViewer gs://docs-solvapay-com
   ```

3. **Set Up Cloud Load Balancer:**
   - Create HTTP(S) Load Balancer in GCP Console
   - Add backend bucket pointing to your GCS bucket
   - Configure SSL certificate (Google-managed or self-managed)
   - Reserve static IP address

4. **Configure Cloud CDN:**
   - Enable Cloud CDN on the load balancer
   - Configure cache policies
   - Set up cache invalidation

5. **Configure DNS:**
   - Add A record: `docs.solvapay.com` → Load Balancer IP address
   - Or use CNAME if using Google-managed domain

6. **SSL Certificate:**
   - Use Google-managed SSL certificate (recommended)
   - Or upload your own certificate
   - Certificate auto-provisions with Google-managed option

### Versioning Strategy

**Option 1: Latest Only (Recommended for now)**
- Always show latest version
- Simple, no version dropdown
- Good for active development phase

**Option 2: Versioned Docs (Future)**
- When SDK reaches v1.0.0, enable versioning
- Docusaurus supports versioning out of the box
- Users can select version from dropdown
- Archive old versions automatically

### Search Functionality

**Option 1: Algolia DocSearch (Free for Open Source)**
- Apply at https://docsearch.algolia.com/
- Free for open source projects
- Excellent search experience
- Auto-indexes documentation

**Option 2: Local Search (Docusaurus Built-in)**
- Works out of the box
- No external dependencies
- Good for smaller docs sites

### Maintenance & Updates

**Automated:**
- ✅ API reference auto-updates from TypeDoc
- ✅ Backend routes auto-updates from OpenAPI spec
- ✅ Deployments trigger on code changes

**Manual:**
- 📝 Getting started guides
- 📝 Tutorials and examples
- 📝 Best practices

**Update Frequency:**
- **API Reference**: Auto-updates on every SDK build
- **Guides**: Update as features change
- **Examples**: Update with SDK releases

### Recommended Approach Summary

**Best Solution: Docusaurus + Google Cloud Storage + Cloud CDN**

1. ✅ **Professional appearance** with minimal setup
2. ✅ **Automatic deployments** from GitHub Actions
3. ✅ **Custom domain** support (docs.solvapay.com)
4. ✅ **TypeDoc integration** for API reference
5. ✅ **OpenAPI integration** for backend routes
6. ✅ **Fast, global CDN** via Cloud CDN
7. ✅ **Cost-effective** pay-as-you-go pricing
8. ✅ **Easy SSL** management via Load Balancer
9. ✅ **Integrates** with existing SDK build process
10. ✅ **Versioning support** via GCS versioning

**Implementation Steps:**

1. Initialize Docusaurus in `docs-site/` directory
2. Configure TypeDoc plugin for API reference
3. Configure OpenAPI plugin for backend routes
4. Set up Google Cloud Storage bucket for static hosting
5. Configure Cloud Load Balancer with SSL certificate
6. Set up Cloud CDN for global distribution
7. Configure custom domain (docs.solvapay.com)
8. Add GitHub Actions workflow for automated builds
9. Start writing documentation in `docs/` directory

---

## Conclusion

This plan provides a comprehensive roadmap for creating world-class documentation for the SolvaPay SDK. By following this plan, we'll create documentation that:

- ✅ **Helps developers get started quickly**
- ✅ **Provides comprehensive API reference**
- ✅ **Includes practical, tested examples**
- ✅ **Automatically stays up-to-date with code changes**
- ✅ **Is searchable and navigable**
- ✅ **Follows modern documentation best practices**

The key to success is:
1. **Start with JSDoc comments** in the code
2. **Generate docs automatically** with TypeDoc
3. **Add guides and examples** for common use cases
4. **Integrate into CI/CD** for automatic updates
5. **Iterate based on user feedback**

Let's build kick-ass documentation! 🚀

---

## Appendix A: Setup & Migration Guide

### Overview

This section provides step-by-step instructions for setting up a new `solvapay-docs` repository and migrating documentation from the SDK repository.

### Step 1: Create New Documentation Repository

1. **Create the repository on GitHub:**
   ```bash
   # On GitHub, create a new repository: solvapay-docs
   # Make it public or private (both work with GCS)
   ```

2. **Clone and initialize locally:**
   ```bash
   git clone https://github.com/solvapay/solvapay-docs.git
   cd solvapay-docs
   ```

### Step 2: Copy Documentation Files

**Files to copy from `solvapay-sdk/docs/`:**

```bash
# From the SDK repository root
cd /Users/tommy/projects/solvapay/solvapay-sdk

# Copy documentation plan
cp docs/DOCUMENTATION_PLAN.md ../solvapay-docs/

# Copy other documentation files (optional, for reference)
cp docs/architecture.md ../solvapay-docs/docs/reference/
cp docs/contributing.md ../solvapay-docs/docs/reference/
cp docs/publishing.md ../solvapay-docs/docs/reference/
```

**Create directory structure:**
```bash
cd ../solvapay-docs
mkdir -p docs/reference docs/getting-started docs/guides
```

### Step 3: Initialize Docusaurus

```bash
cd solvapay-docs

# Initialize Docusaurus with TypeScript
npx create-docusaurus@latest docs-site classic --typescript

# This creates a docs-site/ directory
```

### Step 4: Set Up Git Submodules

**Add SDK repositories as submodules:**

```bash
cd solvapay-docs

# Add TypeScript SDK as submodule
git submodule add https://github.com/solvapay/solvapay-sdk.git sdks/typescript

# Add Python SDK as submodule (later)
# git submodule add https://github.com/solvapay/solvapay-sdk-python.git sdks/python

# Add Frontend as submodule (if needed)
# git submodule add https://github.com/solvapay/solvapay-frontend.git frontend
```

**Note:** If repositories are private, you may need to use SSH URLs:
```bash
git submodule add git@github.com:solvapay/solvapay-sdk.git sdks/typescript
```

### Step 5: Configure Docusaurus

**Update `docs-site/docusaurus.config.ts`:**

Use the configuration from Section 11 (Multi-Repo Documentation Strategy). Key points:

1. Set `url` to `https://docs.solvapay.com`
2. Configure multiple `@docusaurus/plugin-content-docs` instances for each SDK
3. Set up navigation with SDK dropdowns
4. Configure edit URLs to point to respective SDK repos

**Create sidebar files:**

- `docs-site/sidebars.ts` - Main getting started sidebar
- `docs-site/sidebars-typescript.ts` - TypeScript SDK sidebar
- `docs-site/sidebars-python.ts` - Python SDK sidebar (later)

### Step 6: Create Initial Documentation Structure

**Create getting started docs:**

```bash
cd solvapay-docs/docs-site/docs

# Create getting started structure
mkdir -p getting-started
touch getting-started/introduction.md
touch getting-started/dashboard-setup.md
touch getting-started/installation.md
```

**Initial content for `getting-started/introduction.md`:**
```markdown
# Introduction to SolvaPay

SolvaPay helps you monetize your AI agents and APIs with usage-based pricing and subscriptions.

## What is SolvaPay?

[Add introduction content]

## Key Features

- Usage-based pricing
- Subscription management
- Paywall protection
- Multi-SDK support

## Next Steps

- [Set up your dashboard](/getting-started/dashboard-setup)
- [Install an SDK](/getting-started/installation)
```

**Initial content for `getting-started/installation.md`:**
```markdown
# SDK Installation

Choose your preferred language:

- [TypeScript SDK](/sdks/typescript/installation) - For Node.js, Next.js, React
- [Python SDK](/sdks/python/installation) - For Python applications (later)
```

### Step 7: Set Up SDK Documentation Structure

**In each SDK repository, create `docs/` directory:**

For TypeScript SDK (`solvapay-sdk/docs/`):
```bash
cd solvapay-sdk
mkdir -p docs/api-reference docs/guides docs/examples

# Create intro file
cat > docs/intro.md << 'EOF'
# TypeScript SDK

The SolvaPay TypeScript SDK provides paywall protection and payment flows for Node.js, Next.js, and React applications.

## Quick Links

- [Installation](./installation)
- [Quick Start](./quick-start)
- [API Reference](./api-reference/server)
EOF
```

### Step 8: Configure Build Scripts

**Add to `solvapay-docs/package.json`:**

```json
{
  "name": "solvapay-docs",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "docs:update-submodules": "git submodule update --remote --merge",
    "docs:build": "npm run docs:update-submodules && cd docs-site && npm run build",
    "docs:dev": "cd docs-site && npm run start",
    "docs:serve": "cd docs-site && npm run serve"
  }
}
```

### Step 9: Set Up GitHub Actions

**Create `.github/workflows/deploy-docs.yml`:**

Use the workflow from Section 11. Key points:

1. Checkout with submodules: `submodules: recursive`
2. Update submodules to latest
3. Build Docusaurus site
4. Authenticate to Google Cloud
5. Deploy to Google Cloud Storage
6. Invalidate Cloud CDN cache

**Required GitHub Secrets (for Google Cloud):**
- `GCP_SA_KEY` - Service account key JSON (base64 encoded or raw JSON)
- `GCS_BUCKET_NAME` - Name of the GCS bucket (e.g., `docs-solvapay-com`)
- `CDN_URL_MAP` - Name of the Cloud CDN URL map (optional, for cache invalidation)
- `GCP_PROJECT_ID` - Google Cloud project ID

### Step 10: Configure Google Cloud Storage and Custom Domain

**Set Up GCS Bucket:**

1. **Create bucket:**
   ```bash
   gsutil mb -p YOUR_PROJECT_ID -c STANDARD -l US-CENTRAL1 gs://docs-solvapay-com
   ```

2. **Configure for website hosting:**
   ```bash
   gsutil web set -m index.html -e 404.html gs://docs-solvapay-com
   gsutil iam ch allUsers:objectViewer gs://docs-solvapay-com
   ```

3. **Set up Cloud Load Balancer:**
   - Go to GCP Console → Network Services → Load Balancing
   - Create HTTP(S) Load Balancer
   - Add backend bucket pointing to `docs-solvapay-com`
   - Configure SSL certificate (Google-managed recommended)
   - Reserve static IP address

4. **Enable Cloud CDN:**
   - Enable Cloud CDN on the load balancer
   - Configure cache policies

5. **Configure DNS:**
   - Add A record: `docs.solvapay.com` → Load Balancer IP
   - Wait for DNS propagation

**DNS Configuration:**
```
Type: A
Name: docs
Value: [Load Balancer IP Address]
TTL: 3600
```

### Step 11: Initial Commit and Push

```bash
cd solvapay-docs

# Add all files
git add .

# Initial commit
git commit -m "docs: initial documentation site setup

- Add Docusaurus configuration
- Add getting started documentation
- Set up multi-repo structure with git submodules
- Configure deployment workflow"

# Push to main branch
git push origin main
```

### Step 12: Verify Setup

1. **Check submodules are initialized:**
   ```bash
   git submodule status
   ```

2. **Test local build:**
   ```bash
   npm run docs:dev
   # Visit http://localhost:3000
   ```

3. **Test production build:**
   ```bash
   npm run docs:build
   npm run docs:serve
   # Visit http://localhost:3000
   ```

### Files Checklist

**Copy these files from SDK repo:**

- [x] `docs/DOCUMENTATION_PLAN.md` → Root of docs repo (for reference)
- [x] `docs/architecture.md` → `docs/reference/architecture.md` (optional)
- [x] `docs/contributing.md` → `docs/reference/contributing.md` (optional)
- [x] `docs/publishing.md` → `docs/reference/publishing.md` (optional)

**Create these in new docs repo:**

- [x] `docs-site/` - Docusaurus site (created by `create-docusaurus`)
- [x] `docs-site/docusaurus.config.ts` - Main configuration
- [x] `docs-site/sidebars.ts` - Main sidebar
- [x] `docs-site/sidebars-typescript.ts` - TypeScript SDK sidebar
- [x] `docs-site/docs/getting-started/` - Getting started docs
- [x] `.github/workflows/deploy-docs.yml` - Deployment workflow
- [x] `package.json` - Root package.json with scripts
- [x] `README.md` - Docs repo README

**In each SDK repo, create:**

- [x] `docs/intro.md` - SDK introduction
- [x] `docs/installation.md` - Installation guide
- [x] `docs/quick-start.md` - Quick start guide
- [x] `docs/api-reference/` - API reference docs
- [x] `docs/guides/` - Framework-specific guides

### What to Adapt/Update

1. **Repository URLs:**
   - Update all GitHub URLs in configs to match your actual repo names
   - Update edit URLs in Docusaurus config

2. **SDK Paths:**
   - Adjust submodule paths if different (`sdks/typescript`, `sdks/python` (later))
   - Update route base paths in Docusaurus config

3. **Domain Configuration:**
   - Update `url` in `docusaurus.config.ts` to `https://docs.solvapay.com`
   - Configure DNS records for custom domain

4. **Build Process:**
   - Adapt build scripts if using different package manager (pnpm vs npm)
   - Update TypeDoc generation if needed for TypeScript SDK

5. **Deployment:**
   - Set up Google Cloud Storage bucket
   - Configure Cloud Load Balancer and CDN
   - Configure GitHub secrets (GCP service account key, bucket name)
   - Set up custom domain

### Quick Start Commands

```bash
# 1. Clone and setup
git clone https://github.com/solvapay/solvapay-docs.git
cd solvapay-docs

# 2. Initialize Docusaurus
npx create-docusaurus@latest docs-site classic --typescript

# 3. Add SDK submodules
git submodule add https://github.com/solvapay/solvapay-sdk.git sdks/typescript

# 4. Install dependencies
cd docs-site
npm install

# 5. Start development server
npm run start

# 6. Build for production
npm run build

# 7. Serve production build
npm run serve
```

### Troubleshooting

**Submodules not updating:**
```bash
git submodule update --init --recursive
git submodule update --remote --merge
```

**Build fails with missing SDK docs:**
- Ensure submodules are initialized
- Check that SDK repos have `docs/` directories
- Verify paths in `docusaurus.config.ts`

**Deployment fails:**
- Check GitHub Actions logs
- Verify GCP service account key is correct
- Ensure service account has `Storage Admin` role
- Verify bucket name matches secret
- Check GCP project ID is correct

**Custom domain not working:**
- Verify DNS A record points to Load Balancer IP
- Check Load Balancer is configured correctly
- Verify SSL certificate is provisioned
- Wait for DNS propagation (can take up to 48 hours)
- Check Cloud CDN cache invalidation

### Next Steps After Setup

1. **Write Getting Started Content:**
   - Complete `getting-started/introduction.md`
   - Complete `getting-started/dashboard-setup.md`
   - Add screenshots and examples

2. **Set Up SDK Documentation:**
   - **TypeScript SDK**: Generate API reference from code using TypeDoc
   - **Python SDK (later)**: Generate API reference from code using Sphinx or MkDocs
   - Add content to each SDK's `docs/` directory
   - Write framework-specific guides

3. **Configure Search:**
   - Apply for Algolia DocSearch (if open source)
   - Or configure local search

4. **Set Up Versioning:**
   - Configure Docusaurus versioning plugin (when ready)
   - Set up versioned docs for each SDK

5. **Add Examples:**
   - Link to example projects
   - Add code snippets
   - Create interactive examples

### Additional Resources

- [Docusaurus Documentation](https://docusaurus.io/docs)
- [Docusaurus Multi-Instance Docs](https://docusaurus.io/docs/docs-multi-instance)
- [Git Submodules Guide](https://git-scm.com/book/en/v2/Git-Tools-Submodules)
- [Google Cloud Storage Documentation](https://cloud.google.com/storage/docs)
- [Cloud CDN Documentation](https://cloud.google.com/cdn/docs)
- [Cloud Load Balancing Documentation](https://cloud.google.com/load-balancing/docs)
- [TypeDoc Documentation](https://typedoc.org/) - For TypeScript/JavaScript
- [Sphinx Documentation](https://www.sphinx-doc.org/) - For Python (standard tool)
- [MkDocs Documentation](https://www.mkdocs.org/) - For Python (simpler alternative)
- [mkdocstrings Documentation](https://mkdocstrings.github.io/) - Auto-generate docs from Python docstrings

---

## Appendix B: Repository Structure Reference

### Final Repository Structure

```
solvapay-docs/
├── .github/
│   └── workflows/
│       └── deploy-docs.yml          # Deployment workflow
├── docs-site/                         # Docusaurus site
│   ├── blog/                         # (disabled)
│   ├── docs/                         # Central documentation
│   │   ├── getting-started/
│   │   │   ├── introduction.md
│   │   │   ├── dashboard-setup.md
│   │   │   └── installation.md
│   │   └── guides/                  # General guides
│   ├── src/
│   │   ├── css/
│   │   │   └── custom.css
│   │   └── pages/
│   │       └── index.tsx            # Homepage
│   ├── static/
│   │   └── img/                     # Images
│   ├── docusaurus.config.ts          # Main config
│   ├── sidebars.ts                   # Main sidebar
│   ├── sidebars-typescript.ts        # TypeScript SDK sidebar
│   ├── sidebars-python.ts           # Python SDK sidebar (later)
│   ├── package.json
│   └── tsconfig.json
├── sdks/                              # Git submodules
│   ├── typescript/                   # TypeScript SDK submodule
│   │   └── docs/                     # TypeScript SDK docs
│   └── python/                       # Python SDK submodule (later)
│       └── docs/                     # Python SDK docs
├── docs/                              # Reference docs (copied from SDK repo)
│   └── reference/
│       ├── architecture.md
│       ├── contributing.md
│       └── publishing.md
├── DOCUMENTATION_PLAN.md             # This file
├── package.json                       # Root package.json
└── README.md                         # Docs repo README
```

### SDK Repository Structure (Each SDK)

```
solvapay-sdk/
├── docs/
│   ├── intro.md                      # SDK introduction
│   ├── installation.md               # Installation guide
│   ├── quick-start.md                # Quick start
│   ├── api-reference/                # API reference
│   │   ├── server.md
│   │   ├── react.md
│   │   └── next.md
│   ├── guides/                       # Framework guides
│   │   ├── express.md
│   │   ├── nextjs.md
│   │   └── mcp.md
│   └── examples/                     # Code examples
│       └── examples.md
├── packages/                         # SDK packages
└── README.md                         # SDK overview
```

