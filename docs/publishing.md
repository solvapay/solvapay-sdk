# Publishing & Releasing

This document describes the automated publishing and release process for SolvaPay SDK packages.

## Overview

The SolvaPay SDK uses an automated publishing workflow that:
- Publishes three packages: `@solvapay/core`, `@solvapay/react`, and `@solvapay/server`
- Uses **fixed versioning** - all packages share the same version number
- Auto-increments the **patch** version on every push to `main` branch
- Generates changelogs using conventional commits
- Publishes to npm automatically via GitHub Actions

## Branching Strategy

- **`dev`** - Main development branch where all work happens
- **`main`** - Production branch that triggers automated publishing

### Workflow

1. Develop features and fixes in the `dev` branch
2. When ready to publish, merge `dev` into `main`
3. Push to `main` triggers the automated publishing workflow
4. A new patch version is automatically created and published to npm

## Versioning

### Automatic (Default)

Every push to `main` automatically increments the patch version:
- `0.1.0` → `0.1.1` → `0.1.2` → `0.1.3` ...

This is ideal for the preview/alpha release phase with frequent changes.

### Manual Version Bumps

For minor or major version changes, run the appropriate command locally **before** pushing to `main`:

```bash
# Bump minor version (0.1.x → 0.2.0)
pnpm version:bump:minor

# Bump major version (0.x.x → 1.0.0)
pnpm version:bump:major
```

These commands will:
1. Update all three package.json files with the new version
2. Generate changelog based on conventional commits
3. Show you the next steps (commit and push)

Then commit and push to `main` to publish:

```bash
git add .
git commit -m "chore: bump version to 0.2.0"
git push origin main
```

## Conventional Commits

The SDK uses [Conventional Commits](https://www.conventionalcommits.org/) for automatic changelog generation.

### Commit Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- **feat**: A new feature (triggers minor version in semantic versioning)
- **fix**: A bug fix (triggers patch version)
- **docs**: Documentation only changes
- **style**: Code style changes (formatting, missing semi-colons, etc.)
- **refactor**: Code changes that neither fix bugs nor add features
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **build**: Build system or external dependencies
- **ci**: CI/CD changes
- **chore**: Other changes that don't modify src or test files

### Examples

```bash
feat(server): add webhook signature verification
fix(react): resolve payment form validation issue
docs: update installation instructions
refactor(core): simplify schema validation logic
```

### Breaking Changes

For breaking changes, add `BREAKING CHANGE:` in the commit body or footer:

```bash
feat(server)!: redesign payable API

BREAKING CHANGE: The payable() method now requires an options object
instead of individual parameters.
```

## GitHub Actions Workflows

The SDK uses two automated publishing workflows:

### 1. Stable Release Workflow (`.github/workflows/publish.yml`)

Runs on every push to `main` branch:

1. **Checks out** the repository with full git history
2. **Installs** dependencies using pnpm
3. **Runs tests** to ensure quality
4. **Bumps version** and generates changelog (patch increment)
5. **Builds** all packages
6. **Publishes** to npm registry (default `latest` tag)
7. **Commits** version changes back to main
8. **Creates git tag** (e.g., `v0.1.1`)
9. **Pushes** changes and tags

### 2. Preview Release Workflow (`.github/workflows/publish-preview.yml`)

Runs on every push to `dev` branch:

1. **Checks out** the repository with full git history
2. **Installs** dependencies using pnpm
3. **Runs tests** to ensure quality
4. **Bumps preview version** (e.g., `0.1.0-preview.1`)
5. **Builds** all packages
6. **Publishes** to npm registry with `preview` tag
7. **Commits** version changes back to dev
8. **Creates git tag** (e.g., `v0.1.0-preview.1`)
9. **Pushes** changes and tags

### Required Secrets

Both workflows require the following GitHub secret:

- **`NPM_TOKEN`** - NPM access token with publish permissions

To set up:
1. Go to GitHub repository → Settings → Secrets and variables → Actions
2. Add `NPM_TOKEN` with your npm access token

### Authentication Strategy

The workflows use the modern `setup-node@v4` action with `registry-url` which automatically handles npm authentication via the `NODE_AUTH_TOKEN` environment variable (set from `NPM_TOKEN` secret). This is the recommended approach for CI/CD.

## Local Publishing (Manual)

For testing or emergency publishing, you can publish manually:

### Prerequisites

Authenticate with npm CLI (one-time setup):

```bash
npm login
```

Or set your npm token directly:

```bash
npm config set //registry.npmjs.org/:_authToken YOUR_NPM_TOKEN
```

This stores your credentials in `~/.npmrc` globally, so you don't need to authenticate again.

### Steps

1. **Bump version** (if needed):
```bash
pnpm version:bump        # patch
pnpm version:bump:minor  # minor
pnpm version:bump:major  # major
```

2. **Build packages**:
```bash
pnpm build:packages
```

3. **Publish**:
```bash
pnpm publish:packages
```

4. **Commit and push**:
```bash
git add .
git commit -m "chore: bump version to X.X.X"
git tag "vX.X.X"
git push origin main --tags
```

## Package Access

All packages are published with **public access** under the `@solvapay` scope:
- `@solvapay/core`
- `@solvapay/react`
- `@solvapay/server`

## Authentication Best Practices

The SDK uses a clean dual-authentication strategy:

### Local Development (npm CLI)
- Use `npm login` to authenticate once
- Credentials stored in `~/.npmrc` globally
- No environment variables needed
- Simple and secure

### CI/CD (GitHub Actions)
- Use `NPM_TOKEN` as a GitHub secret
- `setup-node` action handles authentication automatically
- Uses `NODE_AUTH_TOKEN` environment variable
- Industry standard approach

**Why this is clean:**
- No `.npmrc` auth token needed in the repository
- Local devs don't manage environment variables
- CI/CD uses secure secret management
- Both methods work independently without conflicts

## Troubleshooting

### Publishing Fails

1. **Check NPM_TOKEN**: Ensure the token has publish permissions
2. **Check package names**: Verify packages don't already exist with those versions
3. **Check tests**: Ensure all tests pass before publishing
4. **Check build**: Ensure packages build successfully

### Version Already Published

If a version already exists on npm, you'll need to bump to the next version:

```bash
pnpm version:bump
git add .
git commit -m "chore: bump version"
git push origin main
```

### Workflow Not Triggering

1. Check that you pushed to the `main` branch (not `dev`)
2. Verify GitHub Actions are enabled in repository settings
3. Check workflow file syntax in `.github/workflows/publish.yml`

## Preview Versions

Preview versions allow you to publish pre-release versions from the `dev` branch for testing and early feedback without affecting the stable release channel.

### What are Preview Versions?

Preview versions use the format `X.Y.Z-preview.N` (e.g., `0.1.0-preview.1`, `0.1.0-preview.2`) and are published to npm with the `preview` dist-tag. This means:

- **Stable installs**: `npm install @solvapay/core` gets the latest stable version from `main`
- **Preview installs**: `npm install @solvapay/core@preview` gets the latest preview version from `dev`
- **Specific version**: `npm install @solvapay/core@0.1.0-preview.1` installs that exact preview

### When to Use Preview Versions

Use preview versions when you want to:
- Share in-progress work with team members or early adopters
- Test features in real environments before merging to `main`
- Iterate quickly on experimental features
- Get feedback on breaking changes

**Don't use preview versions for production deployments** - they are intentionally unstable and may change rapidly.

### Publishing Preview Versions

Preview versions can be published in two ways:

#### Option A: Automated Publishing (Recommended)

Every push to the `dev` branch automatically:
1. Runs tests
2. Bumps the preview version
3. Publishes to npm with `preview` tag
4. Commits version changes back to `dev`

Simply push your changes to `dev`:

```bash
git push origin dev
```

The GitHub Actions workflow handles the rest!

#### Option B: Manual Publishing

For manual control or local testing:

**Prerequisites:** Authenticate with npm (one-time setup):

```bash
npm login
```

**Step 1: Bump to Preview Version**

```bash
# Increments the preview counter
pnpm version:bump:preview
```

This will:
- Detect your current version (e.g., `0.1.0`)
- Increment to next preview (e.g., `0.1.0-preview.1`)
- If already a preview, increment the number (e.g., `0.1.0-preview.1` → `0.1.0-preview.2`)
- Update all three package.json files

#### Step 2: Build Packages

```bash
pnpm build:packages
```

#### Step 3: Publish to npm

```bash
pnpm publish:preview
```

This publishes all three packages with the `preview` dist-tag.

#### Step 4: Commit and Push

```bash
git add .
git commit -m "chore: bump preview to 0.1.0-preview.1"
git push origin dev
```

### Installing Preview Versions

Users can install preview versions in several ways:

```bash
# Get the latest preview version
npm install @solvapay/core@preview
npm install @solvapay/react@preview
npm install @solvapay/server@preview

# Install a specific preview version
npm install @solvapay/core@0.1.0-preview.1

# In package.json
{
  "dependencies": {
    "@solvapay/core": "preview",
    "@solvapay/react": "preview",
    "@solvapay/server": "preview"
  }
}
```

### Preview Version Lifecycle

1. **Create preview**: When you want to share work from `dev`
2. **Iterate**: Bump preview versions as often as needed
3. **Stabilize**: Once ready, merge `dev` → `main` for a stable release
4. **Reset**: After merging to `main`, the next preview starts fresh (e.g., `0.1.1-preview.1`)

### Best Practices for Previews

1. **Publish often** - Preview versions are cheap and meant for rapid iteration
2. **Test locally first** - Even previews should work correctly
3. **Document breaking changes** - Let preview users know what changed
4. **Don't accumulate previews** - Merge to `main` regularly to avoid too many preview versions
5. **Communicate** - Let users know when a preview is ready to test

### Transitioning from Preview to Stable

When you're ready to release a stable version:

1. Ensure all tests pass on `dev`
2. Merge `dev` into `main`
3. Push to `main` to trigger automated publishing
4. A new stable patch version is automatically created (e.g., `0.1.1`)

The stable version will supersede all preview versions of that base version.

## Best Practices

1. **Always use conventional commits** for better changelogs
2. **Test locally** before pushing to main
3. **Review the changelog** before publishing major versions
4. **Update documentation** when adding features
5. **Keep dev and main in sync** - merge dev → main regularly during preview phase

## Skipping Publishing

To push to `main` or `dev` without triggering a publish (e.g., for docs-only changes), add `[skip ci]` to your commit message:

```bash
git commit -m "docs: update README [skip ci]"
```

Note: Both automated workflows already add `[skip ci]` to version bump commits to prevent infinite loops.

## Notes

- This workflow is optimized for rapid iteration during the preview/alpha phase (0.x versions)
- Future improvements (release branches, pre-releases, etc.) will be added when moving to v1.0+

