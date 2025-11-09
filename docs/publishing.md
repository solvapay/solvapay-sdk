# Publishing & Releasing

This document describes the automated publishing and release process for SolvaPay SDK packages.

## Overview

The SolvaPay SDK uses an automated publishing workflow that:

- Publishes seven packages: `@solvapay/core`, `@solvapay/react`, `@solvapay/react-supabase`, `@solvapay/server`, `@solvapay/auth`, `@solvapay/next`, and `create-solvapay-app`
- Uses **fixed versioning** - all packages share the same version number
- Auto-increments the **patch** version on every push to `main` branch
- Generates changelogs using conventional commits
- Publishes to npm automatically via GitHub Actions

## Branching Strategy

- **`dev`** - Main development branch where all work happens
- **`main`** - Production branch that triggers automated publishing

### Workflow

1. Develop features and fixes in the `dev` branch
2. When ready to publish, merge `dev` into `main` (via PR with squash merge)
3. Trigger the publish workflow manually via GitHub Actions UI
4. A new patch version is automatically created and published to npm
5. Version is tracked via git tag (not committed to git)

## Versioning

### Version Bump Strategy

**Important**: Version bumps are **NOT committed back to git**. Versions are tracked via git tags only. This prevents:
- Branch divergence between `dev` and `main`
- Version conflicts when merging `dev` → `main`
- Lockfile conflicts from version changes
- Complex merge cycles

**How it works:**
- When publishing, the workflow reads the current version from `package.json`
- Strips preview suffix if present (e.g., `1.0.0-preview.18` → `1.0.0`)
- Bumps the version (patch increment for stable, preview increment for preview)
- Publishes with the new version
- Creates a git tag (e.g., `v1.0.1`)
- **Does NOT commit version changes back to git**

This means `package.json` versions in git may not match published versions, but versions are accurately tracked via git tags and npm.

### Manual Version Bumps

For minor or major version changes, run the appropriate command locally **before** pushing to `main`:

```bash
# Bump minor version (0.1.x → 0.2.0)
pnpm version:bump:minor

# Bump major version (0.x.x → 1.0.0)
pnpm version:bump:major
```

These commands will:

1. Update all seven package.json files with the new version
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

The SDK uses three automated workflows:

### 1. Stable Release Workflow (`.github/workflows/publish.yml`)

Runs manually via GitHub Actions UI (or on push to `main` if enabled):

1. **Checks out** the repository with full git history
2. **Installs** dependencies using pnpm
3. **Runs tests** to ensure quality
4. **Bumps version** and generates changelog (patch increment)
   - Strips preview suffix if present (e.g., `1.0.0-preview.18` → `1.0.0`)
   - Increments patch version (e.g., `1.0.0` → `1.0.1`)
5. **Builds** all packages
6. **Publishes** to npm registry (default `latest` tag)
7. **Creates git tag** (e.g., `v1.0.1`)
8. **Pushes git tag** (version changes are NOT committed back to git)

**Important**: Version changes are tracked via git tags only, not commits. This prevents branch divergence and version conflicts when merging `dev` → `main`.

### 2. Preview Release Workflow (`.github/workflows/publish-preview.yml`)

Runs manually via GitHub Actions UI (or on push to `dev` if enabled):

1. **Checks out** the repository with full git history
2. **Installs** dependencies using pnpm
3. **Runs tests** to ensure quality
4. **Bumps preview version** (e.g., `0.1.0-preview.1` → `0.1.0-preview.2`)
5. **Builds** all packages
6. **Publishes** to npm registry with `preview` tag
7. **Creates git tag** (e.g., `v0.1.0-preview.2`)
8. **Pushes git tag** (version changes are NOT committed back to git)

**Important**: Version changes are tracked via git tags only, not commits. This prevents branch divergence and version conflicts when merging `dev` → `main`.

### 3. Tag as Latest Workflow (`.github/workflows/tag-as-latest.yml`)

**Manual workflow** triggered via GitHub Actions UI:

1. **Validates** the version format
2. **Checks** which packages exist on npm at that version
3. **Tags** all published @solvapay packages as "latest"
4. **Verifies** the tags were applied correctly

This workflow is useful for promoting preview versions to latest without republishing. It includes an optional **dry run mode** to preview changes before applying them.

### Required Secrets

All workflows require the following GitHub secret:

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

All packages are published with **public access**:

- `@solvapay/core`
- `@solvapay/react`
- `@solvapay/react-supabase`
- `@solvapay/server`
- `@solvapay/auth`
- `@solvapay/next`
- `create-solvapay-app`

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

If a version already exists on npm, trigger the publish workflow again - it will automatically bump to the next version. No manual version bumping or commits needed.

### Workflow Not Triggering

1. Workflows are currently set to manual trigger (`workflow_dispatch`) - use GitHub Actions UI to run them
2. Verify GitHub Actions are enabled in repository settings
3. Check workflow file syntax in `.github/workflows/publish.yml`
4. Ensure you have the required `NPM_TOKEN` secret configured

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

Trigger the preview publish workflow manually via GitHub Actions UI:

1. Go to **Actions** tab in GitHub
2. Select **Publish Preview to NPM** workflow
3. Click **Run workflow**
4. The workflow will:
   - Run tests
   - Bump the preview version
   - Publish to npm with `preview` tag
   - Create and push a git tag (version changes are NOT committed back to git)

**Note**: Version changes are tracked via git tags only to prevent branch divergence.

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
- Update all seven package.json files

#### Step 2: Build Packages

```bash
pnpm build:packages
```

#### Step 3: Publish to npm

```bash
pnpm publish:preview
```

This publishes all seven packages with the `preview` dist-tag.

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
npm install @solvapay/react-supabase@preview
npm install @solvapay/server@preview
npm install @solvapay/auth@preview
npm install @solvapay/next@preview

# Install a specific preview version
npm install @solvapay/core@0.1.0-preview.1

# In package.json
{
  "dependencies": {
    "@solvapay/core": "preview",
    "@solvapay/react": "preview",
    "@solvapay/react-supabase": "preview",
    "@solvapay/server": "preview",
    "@solvapay/auth": "preview",
    "@solvapay/next": "preview"
  }
}
```

### Promoting Preview to Latest

Sometimes you may want to make a preview version the "latest" version on npm (e.g., when preview is more stable than the current latest). This is done through GitHub Actions:

**Steps:**

1. Go to your repository on GitHub
2. Click **Actions** tab
3. Select **Tag Version as Latest** workflow from the left sidebar
4. Click **Run workflow** dropdown (top right)
5. Enter the version you want to tag (e.g., `1.0.0-preview.9`)
6. Optionally enable **Dry run** to preview what would be tagged without making changes
7. Click **Run workflow**

**What it does:**

- Validates the version format
- Checks which packages exist on npm at that version
- Tags all published @solvapay packages at that version as "latest"
- Skips any packages that haven't been published yet
- Shows verification of the tags
- No local setup or authentication required!

**Dry Run Mode:**

Enable the dry run option to see what would be tagged without actually making changes. This is useful for:

- Verifying which packages exist at a specific version
- Testing before actually changing the tags
- Previewing the impact

**Benefits:**

- ✅ No need to be logged in to npm locally
- ✅ Consistent environment (same as publishing)
- ✅ Audit trail in GitHub Actions logs
- ✅ Can be triggered from anywhere (even mobile!)
- ✅ Dry run option to preview changes
- ✅ Automatic validation and safety checks

**Verify the Tags:**

After tagging, verify the changes on npm:

```bash
npm dist-tag ls @solvapay/core
npm dist-tag ls @solvapay/react
```

You should see something like:

```
latest: 1.0.0-preview.9
preview: 1.0.0-preview.9
```

**Important Notes:**

- Only published versions can be tagged - the script will skip packages/versions that don't exist on npm
- This changes what users get when they run `npm install @solvapay/core` (without a version/tag)
- Use this carefully during the preview phase
- All packages are tagged together to maintain version consistency

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
2. **Test locally** before merging dev → main
3. **Review the changelog** before publishing major versions
4. **Update documentation** when adding features
5. **Merge dev → main regularly** - use squash merges for clean history
6. **Never merge main → dev** - this creates cycles and conflicts
7. **Versions are tracked via tags** - don't manually commit version changes

## Skipping Publishing

Since workflows are manually triggered, you can push to `main` or `dev` without triggering a publish. The workflows only run when manually triggered via GitHub Actions UI.

**Note**: Version bump commits are no longer created, so there's no risk of infinite loops.

## Notes

- This workflow is optimized for rapid iteration during the preview/alpha phase (0.x versions)
- Future improvements (release branches, pre-releases, etc.) will be added when moving to v1.0+
