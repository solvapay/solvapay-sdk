#!/bin/bash

# Script to create git tag for already-published version
# Usage: ./scripts/create-missing-tag.sh 1.0.0-preview.18

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/create-missing-tag.sh <version>"
  echo "Example: ./scripts/create-missing-tag.sh 1.0.0-preview.18"
  exit 1
fi

TAG="v${VERSION}"

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "✅ Tag $TAG already exists"
  exit 0
fi

# Get the current commit (or specify a commit)
COMMIT=$(git rev-parse HEAD)

echo "Creating tag $TAG at commit $COMMIT"
git tag -a "$TAG" -m "chore: tag version ${VERSION}"

echo "✅ Created tag $TAG"
echo ""
echo "To push the tag:"
echo "  git push origin $TAG"
echo ""
echo "Or push all tags:"
echo "  git push origin --tags"

