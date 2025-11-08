# Multi-Repo Documentation Strategy

## Overview

SolvaPay will have multiple SDK repositories (TypeScript, Python (later), etc.) plus a frontend repository. This section outlines how to organize documentation across multiple repositories while maintaining a unified documentation site at `docs.solvapay.com`.

## Repository Structure

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

## Recommended Approach: Central Docs Repo + Git Submodules

**Best Solution: Docusaurus with Git Submodules**

This approach:

- ✅ **Centralized control** - All docs in one place for deployment
- ✅ **SDK-specific docs** stay in their repos (maintained by SDK teams)
- ✅ **Automatic sync** - Pull latest from each SDK repo at build time
- ✅ **Unified site** - Single docs.solvapay.com with seamless navigation
- ✅ **Version control** - Each SDK repo manages its own docs

## Implementation Strategy

### Option 1: Git Submodules (Recommended)

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

   See [09-setup-guide.md](./09-setup-guide.md) for full Docusaurus configuration.

4. **Build Script with Submodule Update:**

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

### Option 2: GitHub API / Build-Time Fetch (Alternative)

**How it works:**

1. Central docs repo contains Docusaurus site
2. Build script fetches docs from SDK repos via GitHub API
3. Docs are cached locally during build
4. No submodules needed

**Pros:**

- ✅ No submodule management
- ✅ Always gets latest from main branch
- ✅ Simpler git workflow

**Cons:**

- ❌ Requires GitHub API access
- ❌ More complex build process
- ❌ No version pinning

### Option 3: Monorepo with Workspace (If Consolidating)

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

## Recommended Structure for Each SDK Repo

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

## Linking Strategy

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

## Auto-Sync Strategy

**Option 1: Scheduled Updates (Recommended)**

- GitHub Actions runs on schedule
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

## Versioning Strategy

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

## Search Configuration

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

## Best Practices

1. **Consistent Structure**: Use same doc structure across all SDK repos
2. **Cross-Linking**: Link between SDK docs and central docs
3. **Version Pinning**: Pin submodule versions for stable releases
4. **Build Caching**: Cache SDK builds to speed up doc generation
5. **Preview Deployments**: Test doc changes before merging
6. **Automated Checks**: Validate links and markdown on PR

## Recommended Final Structure

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
