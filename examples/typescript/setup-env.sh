#!/bin/bash

# Copy example env templates so local `pnpm dev` hits the platform
# provider-app proxy on :3010. Existing files are left untouched.

echo "Setting up SolvaPay SDK examples environment files..."

copy_if_missing() {
  local src="$1"
  local dest="$2"
  if [ ! -f "$src" ]; then
    echo "${src} not found"
    return
  fi
  if [ -f "$dest" ]; then
    echo "${dest} already exists, skipping"
    return
  fi
  cp "$src" "$dest"
  echo "Created ${dest} from $(basename "$src")"
}

for example in express-basic express-provider-linkage nextjs-auth0 \
  shadcn-checkout tailwind-checkout chat-checkout-demo \
  mcp-oauth-bridge mcp-time-app mcp-checkout-app \
  cloudflare-workers-mcp supabase-edge-mcp; do
  echo "Setting up ${example}..."
  if [ -f "${example}/.env.example" ]; then
    dest="${example}/.env"
    if [ "${example}" = "nextjs-auth0" ]; then
      dest="${example}/.env.local"
    fi
    copy_if_missing "${example}/.env.example" "$dest"
  else
    echo "${example}/.env.example not found"
  fi
done

for example in checkout-demo hosted-checkout-demo; do
  echo "Setting up ${example}..."
  copy_if_missing "${example}/env.example" "${example}/.env.local"
done

echo ""
echo "Environment setup complete"
echo ""
echo "Examples target SOLVAPAY_API_BASE_URL=http://localhost:3010"
echo "(provider-app proxy on the local platform stack)."
echo ""
echo "Fill in SOLVAPAY_SECRET_KEY and product refs from"
echo "http://localhost:3010, then run pnpm dev in the example."
echo ""
echo "For more information, see examples/README.md"
