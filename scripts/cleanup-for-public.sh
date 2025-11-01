#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
BACKUP_NAME="solvapay-sdk-backup"
REPO_DIR=$(pwd)
BACKUP_DIR="$REPO_DIR/../$BACKUP_NAME"
REMOTE_URL=$(git config --get remote.origin.url)

echo -e "${BLUE}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  SolvaPay SDK - Cleanup Script for Public Repository   ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Not in a git repository${NC}"
    exit 1
fi

# Check current branch
CURRENT_BRANCH=$(git branch --show-current)
echo -e "${YELLOW}📍 Current branch: ${CURRENT_BRANCH}${NC}"
echo ""

# Step 1: Create backup
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 1: Creating backup...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ -d "$BACKUP_DIR" ]; then
    echo -e "${YELLOW}⚠️  Backup directory already exists: $BACKUP_DIR${NC}"
    read -p "   Delete and recreate? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$BACKUP_DIR"
        echo -e "${GREEN}✓ Removed existing backup${NC}"
    else
        echo -e "${YELLOW}⚠️  Using existing backup directory${NC}"
    fi
fi

if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${YELLOW}📦 Creating backup: $BACKUP_DIR${NC}"
    git clone --mirror "$REPO_DIR" "$BACKUP_DIR/.git" 2>/dev/null || {
        # Fallback: create regular backup
        echo -e "${YELLOW}📦 Creating regular backup (mirror failed)${NC}"
        mkdir -p "$BACKUP_DIR"
        cd "$BACKUP_DIR"
        git clone "$REPO_DIR" .
        cd "$REPO_DIR"
    }
    echo -e "${GREEN}✓ Backup created successfully${NC}"
else
    echo -e "${GREEN}✓ Backup already exists${NC}"
fi

BACKUP_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
echo -e "${GREEN}   Backup size: $BACKUP_SIZE${NC}"
echo ""

# Step 2: Check for secrets in history
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 2: Checking for secrets in git history...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

SECRETS_FOUND=0

# Check for .env files in history
echo -e "${YELLOW}🔍 Checking for .env files in history...${NC}"
ENV_FILES=$(git log --all --full-history --source --pretty=format:"%H" -- '.env*' '.env.local' '.env.production' 2>/dev/null | head -5)
if [ -n "$ENV_FILES" ]; then
    echo -e "${RED}⚠️  Found .env files in git history:${NC}"
    echo "$ENV_FILES" | while read commit; do
        echo -e "${RED}   - $commit${NC}"
    done
    SECRETS_FOUND=1
else
    echo -e "${GREEN}✓ No .env files found in history${NC}"
fi

# Check for actual secret keys (not examples)
echo -e "${YELLOW}🔍 Checking for secret keys in commit diffs...${NC}"
SECRET_KEYS=$(git log -p --all 2>/dev/null | grep -iE "SOLVAPAY_SECRET_KEY.*=.*sp_[^_]" | grep -v "your_secret_key\|example\|demo\|test\|sandbox_your" | head -5 || true)
if [ -n "$SECRET_KEYS" ]; then
    echo -e "${RED}⚠️  Found potential secret keys in history:${NC}"
    echo "$SECRET_KEYS" | head -3 | sed 's/^/   /'
    SECRETS_FOUND=1
else
    echo -e "${GREEN}✓ No secret keys found in commit diffs${NC}"
fi

# Check for other common secrets
echo -e "${YELLOW}🔍 Checking for other sensitive patterns...${NC}"
OTHER_SECRETS=$(git log -p --all 2>/dev/null | grep -iE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{10,}['\"]" | grep -viE "example|demo|test|your_|placeholder" | head -5 || true)
if [ -n "$OTHER_SECRETS" ]; then
    echo -e "${YELLOW}⚠️  Found potential secrets (review manually):${NC}"
    echo "$OTHER_SECRETS" | head -3 | sed 's/^/   /'
else
    echo -e "${GREEN}✓ No other secrets found${NC}"
fi

echo ""

if [ $SECRETS_FOUND -eq 1 ]; then
    echo -e "${RED}⚠️  WARNING: Potential secrets found in history!${NC}"
    echo -e "${YELLOW}   Consider using git-filter-repo to remove them before making public${NC}"
    echo ""
    read -p "   Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}⚠️  Cleanup cancelled${NC}"
        exit 1
    fi
fi

echo ""

# Ask about removing history
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}History Removal Option${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Do you want to remove ALL commit history?${NC}"
echo -e "${YELLOW}This will create a fresh start with a single 'Initial public release' commit.${NC}"
echo ""
echo -e "  ${GREEN}Pros:${NC}"
echo -e "    • No secrets in history"
echo -e "    • Clean, professional history"
echo -e "    • Smaller repository size"
echo -e "    • No messy development commits"
echo ""
echo -e "  ${RED}Cons:${NC}"
echo -e "    • Loses ALL commit history"
echo -e "    • Contributors lose their commit attribution"
echo -e "    • Requires force push (rewrites remote)"
echo ""
read -p "Remove commit history? (y/N): " -n 1 -r
echo
REMOVE_HISTORY=0
if [[ $REPLY =~ ^[Yy]$ ]]; then
    REMOVE_HISTORY=1
    echo -e "${RED}⚠️  WARNING: This will delete ALL commit history!${NC}"
    echo -e "${RED}⚠️  Make sure you have a backup (already created above)${NC}"
    echo ""
    read -p "Confirm: Remove ALL commit history? (yes/N): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo -e "${YELLOW}⚠️  History removal cancelled${NC}"
        REMOVE_HISTORY=0
    fi
fi

echo ""

# Step 3: Remove history (if requested)
if [ $REMOVE_HISTORY -eq 1 ]; then
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Step 3: Creating fresh history...${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Determine target branch
    TARGET_BRANCH="main"
    if [ "$CURRENT_BRANCH" != "main" ]; then
        echo -e "${YELLOW}Current branch is '$CURRENT_BRANCH', not 'main'${NC}"
        read -p "Create fresh history on which branch? (main/dev) [default: main]: " -r
        echo
        if [[ $REPLY =~ ^[Dd][Ee][Vv]$ ]]; then
            TARGET_BRANCH="dev"
        fi
    fi
    
    echo -e "${YELLOW}📝 Creating orphan branch (no parent commits)...${NC}"
    git checkout --orphan fresh-${TARGET_BRANCH}
    
    echo -e "${YELLOW}📝 Staging all current files...${NC}"
    git add .
    
    echo -e "${YELLOW}📝 Creating initial commit...${NC}"
    git commit -m "Initial public release" || {
        echo -e "${RED}❌ Error: No changes to commit. Make sure you have files staged.${NC}"
        git checkout ${CURRENT_BRANCH}
        exit 1
    }
    
    echo -e "${YELLOW}📝 Replacing ${TARGET_BRANCH} branch...${NC}"
    git branch -D ${TARGET_BRANCH} 2>/dev/null || true
    git branch -m ${TARGET_BRANCH}
    
    echo -e "${GREEN}✓ Fresh history created on ${TARGET_BRANCH}${NC}"
    echo ""
    
    # Handle other branches
    echo -e "${YELLOW}📋 Handling other branches...${NC}"
    OTHER_BRANCHES=$(git branch --list | grep -v "^\*" | grep -v "^  ${TARGET_BRANCH}$" | sed 's/^[ *]*//')
    
    if [ -n "$OTHER_BRANCHES" ]; then
        echo -e "${YELLOW}Found other branches:${NC}"
        echo "$OTHER_BRANCHES" | sed 's/^/   - /'
        echo ""
        echo -e "${YELLOW}What would you like to do with these branches?${NC}"
        echo -e "   1) ${GREEN}Keep and recreate from new ${TARGET_BRANCH}${NC} (recommended)"
        echo -e "   2) ${YELLOW}Delete them${NC}"
        echo -e "   3) ${YELLOW}Keep them pointing to old history${NC} (not recommended)"
        echo ""
        read -p "Choose option (1/2/3) [default: 1]: " -r
        echo
        
        case $REPLY in
            2)
                echo -e "${YELLOW}🗑️  Deleting other branches...${NC}"
                echo "$OTHER_BRANCHES" | xargs -r git branch -D 2>/dev/null || true
                echo -e "${GREEN}✓ Branches deleted${NC}"
                ;;
            3)
                echo -e "${YELLOW}⚠️  Keeping branches pointing to old history${NC}"
                echo -e "${YELLOW}   These branches will reference commits that won't be pushed${NC}"
                echo -e "${YELLOW}   Consider recreating them after pushing the new ${TARGET_BRANCH}${NC}"
                ;;
            *)
                echo -e "${YELLOW}🔄 Recreating branches from new ${TARGET_BRANCH}...${NC}"
                echo "$OTHER_BRANCHES" | while read branch; do
                    if [ -n "$branch" ]; then
                        echo -e "   ${YELLOW}Recreating: ${branch}${NC}"
                        git branch -D "$branch" 2>/dev/null || true
                        git checkout -b "$branch" ${TARGET_BRANCH} 2>/dev/null || {
                            echo -e "   ${RED}Failed to recreate ${branch}${NC}"
                        }
                    fi
                done
                git checkout ${TARGET_BRANCH} >/dev/null 2>&1
                echo -e "${GREEN}✓ Branches recreated from new ${TARGET_BRANCH}${NC}"
                ;;
        esac
    else
        echo -e "${GREEN}✓ No other branches to handle${NC}"
    fi
    
    echo ""
    echo -e "${YELLOW}⚠️  NOTE: You'll need to force push branches:${NC}"
    echo -e "${YELLOW}   git push origin ${TARGET_BRANCH} --force${NC}"
    if [ -n "$OTHER_BRANCHES" ] && [[ ! $REPLY =~ ^[23]$ ]]; then
        echo -e "${YELLOW}   git push origin --all --force${NC} (to push all recreated branches)"
    fi
    echo ""
fi

# Step 4: Clean up git metadata
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ $REMOVE_HISTORY -eq 1 ]; then
    echo -e "${BLUE}Step 4: Cleaning up git metadata...${NC}"
else
    echo -e "${BLUE}Step 3: Cleaning up git metadata...${NC}"
fi
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo -e "${YELLOW}🧹 Cleaning reflog...${NC}"
git reflog expire --expire=now --all
echo -e "${GREEN}✓ Reflog cleaned${NC}"

echo -e "${YELLOW}🧹 Running garbage collection...${NC}"
git gc --prune=now --aggressive
echo -e "${GREEN}✓ Garbage collection complete${NC}"

echo -e "${YELLOW}🧹 Pruning worktrees...${NC}"
git worktree prune
echo -e "${GREEN}✓ Worktrees pruned${NC}"

echo ""

# Step 5: Show current branch status
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ $REMOVE_HISTORY -eq 1 ]; then
    echo -e "${BLUE}Step 5: Current branch status${NC}"
else
    echo -e "${BLUE}Step 4: Current branch status${NC}"
fi
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo -e "${YELLOW}Local branches:${NC}"
git branch | sed 's/^/   /'

echo ""
echo -e "${YELLOW}Remote branches:${NC}"
git branch -r | sed 's/^/   /'

echo ""

# Step 6: Repository size
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
if [ $REMOVE_HISTORY -eq 1 ]; then
    echo -e "${BLUE}Step 6: Repository information${NC}"
else
    echo -e "${BLUE}Step 5: Repository information${NC}"
fi
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

REPO_SIZE=$(du -sh .git 2>/dev/null | cut -f1)
COMMIT_COUNT=$(git rev-list --all --count 2>/dev/null || echo "unknown")

echo -e "${GREEN}Repository size: $REPO_SIZE${NC}"
echo -e "${GREEN}Total commits: $COMMIT_COUNT${NC}"
echo ""

# Step 7: Summary and next steps
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}✨ Cleanup Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo -e "${GREEN}✓ Backup created: $BACKUP_DIR${NC}"
if [ $REMOVE_HISTORY -eq 1 ]; then
    echo -e "${GREEN}✓ Commit history removed (fresh start created)${NC}"
else
    echo -e "${GREEN}✓ Git metadata cleaned${NC}"
fi
echo ""

echo -e "${YELLOW}📋 Next steps to prepare for public release:${NC}"
echo ""

if [ $REMOVE_HISTORY -eq 1 ]; then
    echo -e "   1. ${RED}⚠️  IMPORTANT: Force push the new history:${NC}"
    echo -e "      git push origin ${TARGET_BRANCH} --force"
    echo ""
    echo -e "   2. ${YELLOW}Delete other branches (if needed):${NC}"
    echo -e "      git push origin --delete <branch-name>"
    echo ""
    echo -e "   3. ${YELLOW}Update package.json:${NC}"
    echo -e "      Set 'private: false' or remove 'private' field"
    echo ""
    echo -e "   4. ${YELLOW}Verify cleanup:${NC}"
    echo -e "      git log --oneline"
    echo ""
    echo -e "   5. ${YELLOW}Make repository public on GitHub${NC}"
else
    echo -e "   1. ${YELLOW}Review current branches:${NC}"
    echo -e "      git branch -a"
    echo ""
    echo -e "   2. ${YELLOW}Delete stale local branches:${NC}"
    echo -e "      git branch -D <branch-name>"
    echo ""
    echo -e "   3. ${YELLOW}Delete stale remote branches:${NC}"
    echo -e "      git push origin --delete <branch-name>"
    echo ""
    echo -e "   4. ${YELLOW}If secrets found, clean history with git-filter-repo:${NC}"
    echo -e "      brew install git-filter-repo"
    echo -e "      git filter-repo --path .env --invert-paths"
    echo ""
    echo -e "   5. ${YELLOW}Update package.json:${NC}"
    echo -e "      Set 'private: false' or remove 'private' field"
    echo ""
    echo -e "   6. ${YELLOW}Verify cleanup:${NC}"
    echo -e "      git log --oneline --all"
    echo ""
    echo -e "   7. ${YELLOW}Make repository public on GitHub${NC}"
fi

echo ""

echo -e "${GREEN}✅ Cleanup script completed successfully!${NC}"
echo -e "${BLUE}💾 Backup location: $BACKUP_DIR${NC}"
echo ""

