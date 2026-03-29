#!/bin/bash

# SolvaPay SDK Examples Environment Setup Script

echo "Setting up SolvaPay SDK examples environment files..."

# Express example setup
echo "Setting up express-basic..."
if [ -f "express-basic/.env.example" ]; then
  if [ ! -f "express-basic/.env" ]; then
    cp express-basic/.env.example express-basic/.env
    echo "Created express-basic/.env from .env.example"
  else
    echo "express-basic/.env already exists, skipping"
  fi
else
  echo "express-basic/.env.example not found"
fi

# Next.js examples setup
for example in checkout-demo hosted-checkout-demo; do
  echo "Setting up ${example}..."
  if [ -f "${example}/env.example" ]; then
    if [ ! -f "${example}/.env.local" ]; then
      cp "${example}/env.example" "${example}/.env.local"
      echo "Created ${example}/.env.local from env.example"
    else
      echo "${example}/.env.local already exists, skipping"
    fi
  else
    echo "${example}/env.example not found"
  fi
done

# MCP examples setup
for example in mcp-oauth-bridge mcp-time-app; do
  echo "Setting up ${example}..."
  if [ -f "${example}/.env.example" ]; then
    if [ ! -f "${example}/.env" ]; then
      cp "${example}/.env.example" "${example}/.env"
      echo "Created ${example}/.env from .env.example"
    else
      echo "${example}/.env already exists, skipping"
    fi
  else
    echo "${example}/.env.example not found"
  fi
done

echo ""
echo "Environment setup complete"
echo ""
echo "Next steps:"
echo "1. Edit express-basic/.env with your SolvaPay API key"
echo "2. Edit checkout-demo/.env.local and hosted-checkout-demo/.env.local"
echo "3. Edit mcp-oauth-bridge/.env and mcp-time-app/.env"
echo "4. Run 'pnpm dev' in the example you want to start"
echo ""
echo "For more information, see examples/README.md"
