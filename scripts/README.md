# Scripts

This directory contains utility scripts for the SolvaPay SDK monorepo.

## Documentation Scripts

### `validate-doc-links.ts`

Validates that all markdown links in documentation files are valid and point to existing files.

**Usage:**
```bash
pnpm docs:validate-links
```

**What it does:**
- Scans all `.md` files in the `docs/` directory
- Validates relative file and directory links
- Reports broken links with file and line numbers
- Exits with error code 1 if broken links are found

**Integration:**
- Add to PR checklist (see `CONTRIBUTING.md`)
- Run before committing documentation changes
- Can be integrated into CI/CD pipelines
- Optional: Use `setup-pre-commit-hook.sh` to add automatic validation

See [`docs/documentation/DOC_LINK_VALIDATION.md`](../docs/documentation/DOC_LINK_VALIDATION.md) for detailed documentation.

### `fix-doc-links.sh`

Script to fix common documentation link issues. Run this if links need to be updated after restructuring.

**Note:** This script modifies files in place. Review changes before committing.

## Version Management

- `version-bump.ts` - Bump package versions
- `version-bump-preview.ts` - Preview version changes
- `tag-as-latest.ts` - Tag packages as latest

## Publishing

- `test-publish.ts` - Test publishing workflow

## Repository Management

- `cleanup-for-public.sh` - Prepare repository for public release
- `setup-pre-commit-hook.sh` - Setup git hooks for link validation

