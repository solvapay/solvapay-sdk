# Setup Guide: Creating solvapay-docs Repository

**Current Status:** TypeScript SDK docs are 90% complete and ready to be integrated into a central docs site.

## Step-by-Step Action Plan

### Phase 1: Push Current SDK State to Dev ✅

**Action:** Commit and push all current documentation work to the `dev` branch.

```bash
# From the TypeScript SDK repo
cd /Users/tommy/projects/solvapay/solvapay-sdk

# Check current branch
git status

# If on feat/docs, merge to dev or push directly
git checkout dev
git merge feat/docs  # or cherry-pick commits
# OR if already on dev:
git add .
git commit -m "docs: complete documentation setup (90%)

- Add TypeDoc configuration and API docs generation
- Complete getting started guides
- Add all framework and advanced guides
- Enhance example READMEs
- Generate API reference documentation"

git push origin dev
```

**Why:** The SDK repo should have all its docs committed before being added as a submodule.

---

### Phase 2: Create solvapay-docs Repository

#### 2.1 Create Repository on GitHub

1. Go to GitHub and create a new repository: `solvapay-docs`
2. Make it **public** (for easier submodule access) or **private** (if you prefer)
3. **Don't** initialize with README, .gitignore, or license (we'll set it up manually)

#### 2.2 Clone and Initialize Locally

```bash
# Clone the new repo
cd /Users/tommy/projects/solvapay
git clone https://github.com/solvapay/solvapay-docs.git
cd solvapay-docs
```

#### 2.3 Initialize Docusaurus

```bash
# Initialize Docusaurus with TypeScript
npx create-docusaurus@latest docs-site classic --typescript

# This creates a docs-site/ directory
cd docs-site
npm install
```

#### 2.4 Add TypeScript SDK as Git Submodule

```bash
# From solvapay-docs root
cd /Users/tommy/projects/solvapay/solvapay-docs

# Add TypeScript SDK as submodule
# Use the dev branch or main branch depending on where you pushed
git submodule add -b dev https://github.com/solvapay/solvapay-sdk-typescript.git sdks/typescript

# Or if using SSH:
git submodule add -b dev git@github.com:solvapay/solvapay-sdk-typescript.git sdks/typescript

# Initialize submodule
git submodule update --init --recursive
```

**Note:** The `-b dev` flag sets the submodule to track the `dev` branch. You can change this later if needed.

---

### Phase 3: Configure Docusaurus

#### 3.1 Update Docusaurus Config

Edit `docs-site/docusaurus.config.ts`:

```typescript
import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'SolvaPay Documentation',
  tagline: 'Monetize your AI agents and APIs',
  favicon: 'img/favicon.ico',
  url: 'https://docs.solvapay.com',
  baseUrl: '/',
  organizationName: 'solvapay',
  projectName: 'solvapay-docs',
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
          // Main docs from central repo (optional for now)
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
        editUrl: 'https://github.com/solvapay/solvapay-sdk-typescript/tree/dev/docs/',
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'SolvaPay Docs',
      logo: {
        alt: 'SolvaPay Logo',
        src: 'img/logo.svg',
      },
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
          href: 'https://github.com/solvapay',
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
              label: 'TypeScript SDK',
              to: '/sdks/typescript',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/solvapay',
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

#### 3.2 Create Sidebar Configurations

**Create `docs-site/sidebars.ts`** (main sidebar):

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
        'getting-started/installation',
        'getting-started/quick-start',
        'getting-started/core-concepts',
      ],
    },
  ],
};

export default sidebars;
```

**Create `docs-site/sidebars-typescript.ts`** (TypeScript SDK sidebar):

```typescript
import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  typescriptSidebar: [
    'intro',
    'installation',
    'quick-start',
    'core-concepts',
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/express',
        'guides/nextjs',
        'guides/react',
        'guides/mcp',
        'guides/custom-auth',
        'guides/error-handling',
        'guides/testing',
        'guides/performance',
        'guides/webhooks',
      ],
    },
    {
      type: 'category',
      label: 'API Reference',
      link: {
        type: 'generated-index',
        title: 'API Reference',
        description: 'Auto-generated API documentation from TypeDoc',
        slug: '/api-reference',
      },
      items: [
        // These will be auto-generated or manually linked
        'api/server',
        'api/react',
        'api/next',
        'api/auth',
      ],
    },
    {
      type: 'category',
      label: 'Examples',
      items: [
        'examples/overview',
      ],
    },
  ],
};

export default sidebars;
```

#### 3.3 Create Initial Getting Started Docs

Create `docs-site/docs/getting-started/introduction.md`:

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

Create `docs-site/docs/getting-started/installation.md`:

```markdown
# SDK Installation

Choose your preferred language:

- [TypeScript SDK](/sdks/typescript/installation) - For Node.js, Next.js, React
- [Python SDK](/sdks/python/installation) - For Python applications (coming soon)
```

---

### Phase 4: Set Up SDK Documentation Structure

The TypeScript SDK repo already has its docs in `docs/`, but we need to ensure the structure matches what Docusaurus expects.

**In the TypeScript SDK repo** (`solvapay-sdk-typescript/docs/`), ensure you have:

```
docs/
├── intro.md                    # SDK introduction (required by Docusaurus)
├── installation.md
├── quick-start.md
├── core-concepts.md
├── guides/
│   ├── express.md
│   ├── nextjs.md
│   ├── react.md
│   ├── mcp.md
│   ├── custom-auth.md
│   ├── error-handling.md
│   ├── testing.md
│   ├── performance.md
│   └── webhooks.md
├── api/                        # Auto-generated from TypeDoc
│   └── [TypeDoc output]
└── examples/
    └── overview.md
```

**Note:** Docusaurus requires an `intro.md` file as the entry point. If you don't have one, create it:

```markdown
# TypeScript SDK

The SolvaPay TypeScript SDK provides paywall protection and payment flows for Node.js, Next.js, and React applications.

## Quick Links

- [Installation](./installation)
- [Quick Start](./quick-start)
- [API Reference](./api/server)
```

---

### Phase 5: Test Locally

```bash
# From solvapay-docs/docs-site
cd docs-site

# Update submodule to latest
cd ..
git submodule update --remote --merge
cd docs-site

# Start development server
npm run start

# Visit http://localhost:3000
```

**What to check:**
- ✅ TypeScript SDK docs load from submodule
- ✅ Navigation works
- ✅ Links between docs work
- ✅ API reference is accessible (if you link to it)

---

### Phase 6: Add Build Scripts

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

---

### Phase 7: Initial Commit

```bash
# From solvapay-docs root
cd /Users/tommy/projects/solvapay/solvapay-docs

# Add all files
git add .

# Initial commit
git commit -m "docs: initial documentation site setup

- Initialize Docusaurus site
- Add TypeScript SDK as git submodule
- Configure multi-instance docs structure
- Set up sidebars and navigation"

# Push to main
git push origin main
```

---

## Next Steps After Setup

1. **Configure Deployment** (Phase 6 from DOCUMENTATION_BUILD_PLAN.md)
   - Set up GitHub Actions workflow
   - Configure deployment to Google Cloud Storage (or GitHub Pages)
   - Set up custom domain

2. **Enhance Getting Started Docs**
   - Complete introduction content
   - Add dashboard setup guide
   - Add screenshots and examples

3. **Link API Reference**
   - Either copy TypeDoc output to `sdks/typescript/docs/api/`
   - Or configure Docusaurus to generate it during build
   - Or link to external API docs

4. **Add Search** (Optional)
   - Apply for Algolia DocSearch
   - Or use Docusaurus local search

---

## Troubleshooting

**Submodule not updating:**
```bash
git submodule update --init --recursive
git submodule update --remote --merge
```

**Build fails with missing SDK docs:**
- Ensure submodule is initialized
- Check that SDK repo has `docs/` directory
- Verify paths in `docusaurus.config.ts`

**Docs not showing:**
- Check that `intro.md` exists in SDK docs
- Verify sidebar configuration matches file structure
- Check Docusaurus console for errors

---

## Summary

✅ **Push SDK docs to dev** → Ensures docs are committed and available  
✅ **Create solvapay-docs repo** → Central documentation site  
✅ **Add SDK as submodule** → Pulls docs from SDK repo  
✅ **Configure Docusaurus** → Multi-instance setup for SDK docs  
✅ **Test locally** → Verify everything works  
✅ **Deploy** → Set up CI/CD and hosting (next phase)

This setup allows:
- SDK team maintains docs in SDK repo
- Central docs site automatically pulls latest
- Unified documentation site at docs.solvapay.com
- Easy to add more SDKs later (Python, etc.)

