# create-solvapay-app

CLI tool to quickly set up a Next.js project with SolvaPay and Supabase integration.

## Usage

After publishing to npm, users can run:

```bash
npx create-solvapay-app
```

Or with a specific project name:

```bash
npx create-solvapay-app my-app
```

## What it does

1. Creates a new Next.js project with TypeScript, ESLint, and Tailwind CSS
2. Installs all required SolvaPay packages (@preview versions)
3. Installs Supabase client library
4. Creates `.env.local` with template environment variables
5. Sets up the project structure (creates `src` folder if needed)
6. Copies all guide markdown files to the project root
7. Opens the project in Cursor (or VS Code if Cursor is not available)

## Local Development

To test locally without publishing:

```bash
# From the monorepo root
cd packages/create-solvapay-app
pnpm link --global

# Then use it from anywhere
create-solvapay-app
```

Or use `pnpm exec`:

```bash
# From the monorepo root
pnpm --filter create-solvapay-app exec create-solvapay-app
```

## Publishing

This package should be published separately from the other @solvapay packages. It's a standalone CLI tool.

```bash
cd packages/create-solvapay-app
npm publish --access public
```

