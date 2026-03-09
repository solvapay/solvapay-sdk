# How to Use the Tag as Latest Workflow

This guide shows you how to promote a preview version to "latest" using the GitHub Actions UI.

## Step-by-Step Instructions

### 1. Navigate to Actions Tab

Go to your repository on GitHub and click the **Actions** tab at the top.

### 2. Select the Workflow

In the left sidebar, find and click on **"Tag Version as Latest"**.

### 3. Trigger the Workflow

Click the **"Run workflow"** button (top right, above the workflow runs list).

A dropdown will appear with the following inputs:

```
┌─────────────────────────────────────────────────────────────┐
│ Run workflow                                                 │
│                                                              │
│ Use workflow from:  Branch: main            ▼               │
│                                                              │
│ Version to tag as latest (e.g., 1.0.0-preview.9) *          │
│ ┌──────────────────────────────────────────────────┐       │
│ │ 1.0.0-preview.9                                  │       │
│ └──────────────────────────────────────────────────┘       │
│                                                              │
│ [ ] Dry run (show what would be tagged without actually     │
│   tagging)                                                   │
│                                                              │
│                            [ Run workflow ]                  │
└─────────────────────────────────────────────────────────────┘
```

### 4. Fill in the Inputs

**Version** (Required)

- Enter the exact version you want to tag as "latest"
- Format: `X.Y.Z` or `X.Y.Z-preview.N`
- Example: `1.0.0-preview.9`

**Dry run** (Optional)

- [x] Check this box to preview what would be tagged **without making changes**
- [ ] Leave unchecked to actually tag the version as latest
- Recommended: Run with dry run first!

### 5. Execute the Workflow

Click the **"Run workflow"** button at the bottom of the dropdown.

### 6. Monitor the Workflow

- The workflow will appear in the list of runs
- Click on it to see detailed logs
- Watch for success or errors in each step

## Example Workflows

### Example 1: Preview First (Dry Run)

**Scenario:** You want to check if `1.0.0-preview.9` can be tagged as latest.

**Inputs:**

- Version: `1.0.0-preview.9`
- Dry run: [x] **Enabled**

**What happens:**

- Shows which packages exist at that version
- Shows which packages would be skipped (not published)
- **No changes made to npm**

**Output Example:**

```
DRY RUN MODE - No changes will be made

Would tag the following packages as 'latest':
  - @solvapay/core@1.0.0-preview.9
  - @solvapay/react@1.0.0-preview.9
  - @solvapay/react-supabase@1.0.0-preview.9
  - @solvapay/server@1.0.0-preview.9
  - @solvapay/auth@1.0.0-preview.9
  - @solvapay/next@1.0.0-preview.9

Checking which versions exist on npm...
  @solvapay/core@1.0.0-preview.9 exists
  @solvapay/react@1.0.0-preview.9 exists
  @solvapay/react-supabase@1.0.0-preview.9 not found (would skip)
  @solvapay/server@1.0.0-preview.9 exists
  @solvapay/auth@1.0.0-preview.9 exists
  @solvapay/next@1.0.0-preview.9 exists
```

### Example 2: Actually Tag as Latest

**Scenario:** You've verified with dry run and want to promote the version.

**Inputs:**

- Version: `1.0.0-preview.9`
- Dry run: [ ] **Disabled**

**What happens:**

- Tags all published packages at that version as "latest"
- Skips unpublished packages automatically
- Shows verification of tags
- **Changes npm dist-tags**

**Output Example:**

```
Tag as Latest

Version: 1.0.0-preview.9

Tagging @solvapay/core@1.0.0-preview.9 as "latest"...
  +latest: @solvapay/core@1.0.0-preview.9

Tagging @solvapay/react@1.0.0-preview.9 as "latest"...
  +latest: @solvapay/react@1.0.0-preview.9

[... continues for all packages ...]

Successfully tagged version 1.0.0-preview.9 as 'latest'
```

## Common Use Cases

### Use Case 1: Promote Preview to Latest

You've been testing `1.0.0-preview.9` and it's stable. You want users to get this version when they run `npm install @solvapay/core`.

**Steps:**

1. Run with dry run enabled to verify
2. Run again with dry run disabled to apply

### Use Case 2: Rollback Latest Tag

Latest (`1.0.1`) has a bug. You want to rollback to the previous version (`1.0.0`).

**Steps:**

1. Enter version: `1.0.0`
2. Disable dry run
3. Run workflow

### Use Case 3: Check What's Published

You're not sure if a version exists on npm.

**Steps:**

1. Enter the version you want to check
2. Enable dry run
3. Run workflow to see which packages exist

## Verification

After the workflow completes, verify the changes on npm:

```bash
# Check individual package
npm dist-tag ls @solvapay/core

# Expected output:
# latest: 1.0.0-preview.9
# preview: 1.0.0-preview.9
```

Or visit npm directly:

- https://www.npmjs.com/package/@solvapay/core?activeTab=versions
- https://www.npmjs.com/package/@solvapay/react?activeTab=versions

## Troubleshooting

### "Invalid version format"

**Error:**

```
Invalid version format: 1.0.0preview9
Expected format: X.Y.Z or X.Y.Z-preview.N
```

**Solution:** Use correct format with dot separator: `1.0.0-preview.9` (not `1.0.0preview9`)

### "Version not found"

**Warning:**

```
Version 1.0.0-preview.9 not found for @solvapay/react-supabase (skipping)
```

**Meaning:** This package hasn't been published at that version yet. It will be skipped automatically.

### "401 Unauthorized"

**Error:**

```
Failed to tag @solvapay/core: 401 Unauthorized
```

**Solution:**

- Check that `NPM_TOKEN` secret is set in repository settings
- Verify the token has publish permissions
- Token may have expired - generate a new one

## Best Practices

1. **Always use dry run first** - Preview changes before applying
2. **Verify on npm** - Check dist-tags after tagging
3. **Tag all or none** - Don't tag just some packages (they should all match)
4. **Document decisions** - Note in PR/issue why you're promoting a version
5. **Communicate** - Let team know when changing the "latest" tag

## Safety Features

The workflow includes several safety features:

- **Version validation** - Checks format before proceeding
- **Existence check** - Verifies packages exist on npm
- **Automatic skip** - Skips unpublished packages
- **Dry run mode** - Preview without changes
- **Verification step** - Shows tags after applying
- **Audit trail** - All runs logged in GitHub Actions

## Need Help?

- See [Publishing Documentation](../../docs/publishing.md) for more details
- Check workflow logs for detailed error messages
- Run with dry run enabled to diagnose issues
