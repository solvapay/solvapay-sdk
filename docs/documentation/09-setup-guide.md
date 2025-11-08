# Setup & Migration Guide

## Overview

This section provides step-by-step instructions for setting up a new `solvapay-docs` repository and migrating documentation from the SDK repository.

## Step 1: Create New Documentation Repository

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

## Step 2: Copy Documentation Files

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

## Step 3: Initialize Docusaurus

```bash
cd solvapay-docs

# Initialize Docusaurus with TypeScript
npx create-docusaurus@latest docs-site classic --typescript

# This creates a docs-site/ directory
```

## Step 4: Set Up Git Submodules

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

## Step 5: Configure Docusaurus

**Update `docs-site/docusaurus.config.ts`:**

Use the configuration from [07-multi-repo-strategy.md](./07-multi-repo-strategy.md). Key points:

1. Set `url` to `https://docs.solvapay.com`
2. Configure multiple `@docusaurus/plugin-content-docs` instances for each SDK
3. Set up navigation with SDK dropdowns
4. Configure edit URLs to point to respective SDK repos

**Create sidebar files:**

- `docs-site/sidebars.ts` - Main getting started sidebar
- `docs-site/sidebars-typescript.ts` - TypeScript SDK sidebar
- `docs-site/sidebars-python.ts` - Python SDK sidebar (later)

## Step 6: Create Initial Documentation Structure

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

## Step 7: Set Up SDK Documentation Structure

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

## Step 8: Configure Build Scripts

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

## Step 9: Set Up GitHub Actions

**Create `.github/workflows/deploy-docs.yml`:**

See [08-deployment.md](./08-deployment.md) for deployment workflow. Key points:

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

## Step 10: Configure Google Cloud Storage and Custom Domain

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

## Step 11: Initial Commit and Push

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

## Step 12: Verify Setup

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

## Files Checklist

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

## What to Adapt/Update

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

## Quick Start Commands

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

## Troubleshooting

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
- Wait for DNS propagation
- Check Cloud CDN cache invalidation

## Next Steps After Setup

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

## Additional Resources

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
