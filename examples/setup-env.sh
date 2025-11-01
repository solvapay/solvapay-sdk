#!/bin/bash

# SolvaPay SDK Examples Environment Setup Script

echo "🚀 Setting up SolvaPay SDK Examples Environment Files..."

# Express example setup
echo "📝 Setting up Express example..."
if [ -f "express-basic/.env.example" ]; then
    if [ ! -f "express-basic/.env" ]; then
        cp express-basic/.env.example express-basic/.env
        echo "✅ Created express-basic/.env from .env.example"
        echo "   Please edit express-basic/.env with your actual API key"
    else
        echo "⚠️  express-basic/.env already exists, skipping..."
    fi
else
    echo "❌ express-basic/.env.example not found"
fi

# Next.js example setup
echo "📝 Setting up Next.js example..."
if [ -f "nextjs-basic/.env.local.example" ]; then
    if [ ! -f "nextjs-basic/.env.local" ]; then
        cp nextjs-basic/.env.local.example nextjs-basic/.env.local
        echo "✅ Created nextjs-basic/.env.local from .env.local.example"
        echo "   Please edit nextjs-basic/.env.local with your actual public key"
    else
        echo "⚠️  nextjs-basic/.env.local already exists, skipping..."
    fi
else
    echo "❌ nextjs-basic/.env.local.example not found"
fi

echo ""
echo "🎉 Environment setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit express-basic/.env with your SolvaPay API key"
echo "2. Edit nextjs-basic/.env.local with your SolvaPay public key"
echo "3. Run 'pnpm dev' to start the examples"
echo ""
echo "📚 For more information, see examples/README.md"
