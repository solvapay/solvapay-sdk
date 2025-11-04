# Usage Guide for create-solvapay-app

## Publishing

1. **Version bump** (if needed):
   ```bash
   cd packages/create-solvapay-app
   npm version patch|minor|major
   ```

2. **Publish to npm**:
   ```bash
   npm publish --access public
   ```

## Testing Locally

### Option 1: Using pnpm link (Recommended for local testing)

```bash
# From the package directory
cd packages/create-solvapay-app
pnpm link --global

# Now you can use it from anywhere
create-solvapay-app my-test-project
```

### Option 2: Using npx with local path

```bash
# From the package directory
cd packages/create-solvapay-app
npm pack
# This creates a .tgz file

# Test it locally
npx create-solvapay-app-1.0.0.tgz my-test-project
```

### Option 3: Direct execution

```bash
# From anywhere
/path/to/solvapay-sdk/packages/create-solvapay-app/bin/setup.sh my-test-project
```

## After Publishing

Users can run:

```bash
npx create-solvapay-app
```

Or with a project name:

```bash
npx create-solvapay-app my-app
```

## Package Structure

```
create-solvapay-app/
├── bin/
│   └── setup.sh          # Main executable script
├── guides/                # Guide files to copy to project
│   ├── 01-setup.md
│   ├── 02-authentication.md
│   ├── 03-payments.md
│   ├── 04-styling.md
│   ├── 05-complete-example.md
│   └── README.md
├── package.json
├── README.md
└── .npmignore
```

## Important Notes

- The script uses `#!/bin/bash` - ensure bash is available on target systems
- Guide files are bundled with the package and copied to the project root
- The script handles opening the project in Cursor or VS Code
- Environment variables are created with placeholder values (users need to update them)

