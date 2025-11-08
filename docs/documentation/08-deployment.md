# Documentation Publishing & Deployment Strategy

## Overview

This section outlines how to publish and deploy the SolvaPay SDK documentation to `docs.solvapay.com` with proper organization, hosting, and integration with the SDK build process.

## Domain Structure (Multi-Repo)

The documentation will be organized under `docs.solvapay.com` with the following hierarchy (see [07-multi-repo-strategy.md](./07-multi-repo-strategy.md) for multi-repo setup):

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

**Note:** This structure supports multiple SDK repositories. Each SDK has its own documentation section while maintaining a unified site.

## Recommended Solution: Docusaurus + Custom Domain Deployment

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

## Option 1: Docusaurus + Google Cloud Storage + Cloud CDN (Recommended)

**Pros:**

- ✅ **Automatic deployments** from GitHub Actions
- ✅ **Custom domain** support (docs.solvapay.com)
- ✅ **Fast CDN** globally distributed via Cloud CDN
- ✅ **Cost-effective** pay-as-you-go pricing
- ✅ **Easy SSL** certificate management via Cloud Load Balancer
- ✅ **Integrates with SDK build** process seamlessly
- ✅ **Versioning support** via Cloud Storage versioning

**Setup Steps:**

1. **Initialize Docusaurus** - See [09-setup-guide.md](./09-setup-guide.md)
2. **Configure Docusaurus** - See [09-setup-guide.md](./09-setup-guide.md) for configuration
3. **Deploy to Google Cloud Storage:**
   - Create GCS bucket for static site hosting
   - Configure bucket for website hosting
   - Set up Cloud CDN for global distribution
   - Configure Cloud Load Balancer with SSL certificate
   - Add custom domain: `docs.solvapay.com`
   - Configure DNS: Add A record pointing to load balancer IP

## Option 2: Docusaurus + Google Cloud Run (Alternative)

**Pros:**

- ✅ **Container-based** deployment
- ✅ **Automatic scaling** based on traffic
- ✅ **Custom domain** support
- ✅ **Integrated** with Google Cloud ecosystem

**Cons:**

- ❌ **More complex** setup than static hosting
- ❌ **Higher cost** for low traffic (minimum instances)
- ❌ **Overkill** for static sites (better for dynamic content)

## Option 3: Docusaurus + Firebase Hosting (Alternative)

Firebase Hosting is Google's managed static hosting service. Good alternative if you want a simpler setup than GCS + CDN.

**Pros:**

- ✅ **Simple setup** via Firebase CLI
- ✅ **Automatic SSL** certificates
- ✅ **Fast CDN** included
- ✅ **Free tier** available

**Cons:**

- ❌ **Less control** than GCS + CDN
- ❌ **Firebase-specific** (not pure GCP)

## Documenting Backend SDK Routes

The backend SDK routes (`/v1/sdk/*`) are already defined in `packages/server/src/types/generated.ts` from the OpenAPI spec. To document them:

1. **Create Backend Routes Documentation** (`docs-site/docs/api-reference/backend-routes.md`)
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

## Integration with SDK Build Process

**Option A: Separate Documentation Build (Recommended)**

Documentation builds independently from SDK packages:

1. **Documentation changes** trigger docs deployment
2. **SDK package changes** trigger docs rebuild (to update API reference)
3. **Both can deploy** independently

See [06-ci-cd.md](./06-ci-cd.md) for GitHub Actions workflow.

**Option B: Integrated Build (Alternative)**

Documentation builds as part of SDK release process:

1. **On SDK release**, build docs and deploy
2. **Version docs** with SDK versions
3. **Single deployment** per release

## Documentation Structure in Repository

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

## Deployment Workflow

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

## Custom Domain Setup (docs.solvapay.com)

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

## Versioning Strategy

**Option 1: Latest Only (Recommended for now)**

- Always show latest version
- Simple, no version dropdown
- Good for active development phase

**Option 2: Versioned Docs (Future)**

- When SDK reaches v1.0.0, enable versioning
- Docusaurus supports versioning out of the box
- Users can select version from dropdown
- Archive old versions automatically

## Search Functionality

**Option 1: Algolia DocSearch (Free for Open Source)**

- Apply at https://docsearch.algolia.com/
- Free for open source projects
- Excellent search experience
- Auto-indexes documentation

**Option 2: Local Search (Docusaurus Built-in)**

- Works out of the box
- No external dependencies
- Good for smaller docs sites

## Maintenance & Updates

**Automated:**

- ✅ API reference auto-updates from TypeDoc
- ✅ Backend routes auto-updates from OpenAPI spec
- ✅ Deployments trigger on code changes

**Manual:**

- 📝 Getting started guides
- 📝 Tutorials and examples
- 📝 Best practices

## Recommended Approach Summary

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
