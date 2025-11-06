# CI/CD Integration

## GitHub Actions Workflow

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

## Package.json Scripts

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

## Integration with SDK Build Process

**Option A: Separate Documentation Build (Recommended)**

Documentation builds independently from SDK packages:

1. **Documentation changes** trigger docs deployment
2. **SDK package changes** trigger docs rebuild (to update API reference)
3. **Both can deploy** independently

See [08-deployment.md](./08-deployment.md) for full deployment workflow with Google Cloud Storage.

