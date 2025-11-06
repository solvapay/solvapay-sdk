# Repository Structure Reference

## Final Repository Structure

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

## SDK Repository Structure (Each SDK)

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

