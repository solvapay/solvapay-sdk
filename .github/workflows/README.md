# GitHub Actions Workflows

This directory contains automated workflows for the SolvaPay SDK.

## Workflows

### 🚀 `publish.yml` - Stable Release
**Trigger:** Push to `main` branch (or manual via Actions UI)

Automatically publishes a new stable version to npm with the `latest` tag.

### 🧪 `publish-preview.yml` - Preview Release
**Trigger:** Push to `dev` branch

Automatically publishes a new preview version to npm with the `preview` tag.

### 🏷️ `tag-as-latest.yml` - Tag Version as Latest
**Trigger:** Manual via GitHub Actions UI only

Promotes any existing version (especially preview versions) to the `latest` tag on npm.

**⚠️ This is the ONLY supported way to tag versions as latest.**

**How to use:**
1. Go to **Actions** tab in GitHub
2. Select **Tag Version as Latest** workflow
3. Click **Run workflow**
4. Enter version (e.g., `1.0.0-preview.9`)
5. Optionally enable **Dry run** to preview changes first (recommended!)
6. Click **Run workflow** to execute

**Inputs:**
- `version` (required): Version to promote (e.g., `1.0.0-preview.9`)
- `dry_run` (optional): Preview changes without applying them (recommended first run)

## Required Secrets

All workflows require:
- **`NPM_TOKEN`**: NPM access token with publish permissions

Set up in: **Repository Settings → Secrets and variables → Actions**

## Best Practices

1. ✅ **Always use dry run first**: When using `tag-as-latest.yml`, enable dry run to verify what will be tagged
2. ✅ **Use GitHub Actions only**: Don't run tagging scripts locally - use the workflow for consistency and audit trail
3. ✅ **Check workflow logs**: Always review the workflow execution logs for any issues
4. ✅ **Verify on npm**: After tagging, check `npm dist-tag ls @solvapay/core` to verify tags
5. ✅ **Keep tokens secure**: Never commit or expose `NPM_TOKEN` in logs or code

## Quick Reference

| Action | How to Execute |
|--------|----------------|
| Publish stable release | Push to `main` branch |
| Publish preview release | Push to `dev` branch |
| Tag version as latest | Use **Tag Version as Latest** workflow in GitHub UI |
| Test publish setup | `pnpm test:publish` (local validation only) |

## Troubleshooting

### Workflow fails with 401 Unauthorized
- Check that `NPM_TOKEN` secret is set correctly
- Verify the token has publish permissions for `@solvapay` packages
- Token may have expired - generate a new one

### Version already exists
- Each version can only be published once
- Bump to next version: `pnpm version:bump`
- Or specify different version manually

### Tag-as-latest shows version not found
- The version must be published first before it can be tagged
- Check npm: `npm view @solvapay/core versions`
- Publish the version first, then tag it

## See Also

- [Publishing Documentation](../../docs/publishing.md) - Complete publishing guide
- [Contributing Guide](../../docs/contributing.md) - Development workflow

