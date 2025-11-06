const fs = require('fs');
const path = require('path');

// Route files to recreate
const routes = {
  'src/app/api/user/plan/update/route.ts': `import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';

function loadUserPlans() {
  const filePath = join(process.cwd(), 'user-plans.json');
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (error) {
    return {};
  }
}

function saveUserPlans(plans) {
  const filePath = join(process.cwd(), 'user-plans.json');
  writeFileSync(filePath, JSON.stringify(plans, null, 2));
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { userId, plan } = body;
    
    const userPlans = loadUserPlans();
    userPlans[userId || 'user_1'] = {
      plan: plan || 'pro',
      upgradedAt: new Date().toISOString()
    };
    saveUserPlans(userPlans);
    
    return NextResponse.json({
      success: true,
      userId: userId || 'user_1',
      plan: plan || 'pro'
    });
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}`,

  'src/app/api/things/route.ts': `import { NextRequest, NextResponse } from 'next/server';
import { paywallService } from '../../../services/paywallService';
import { thingsService } from '../../../services/thingsService';

export async function GET(request) {
  try {
    const customerRef = request.headers.get('x-customer-ref') || 'demo_user';
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '10');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    
    const result = await thingsService.listThings({
      limit,
      offset,
      auth: { customer_ref: customerRef }
    });
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const customerRef = request.headers.get('x-customer-ref') || 'demo_user';
    const body = await request.json();
    
    const result = await thingsService.createThing({
      ...body,
      auth: { customer_ref: customerRef }
    });
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}`,

  'src/app/api/things/[id]/route.ts': `import { NextRequest, NextResponse } from 'next/server';
import { thingsService } from '../../../services/thingsService';

export async function GET(request, { params }) {
  try {
    const customerRef = request.headers.get('x-customer-ref') || 'demo_user';
    const result = await thingsService.getThing({
      id: params.id,
      auth: { customer_ref: customerRef }
    });
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const customerRef = request.headers.get('x-customer-ref') || 'demo_user';
    const body = await request.json();
    
    const result = await thingsService.updateThing({
      id: params.id,
      ...body,
      auth: { customer_ref: customerRef }
    });
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const customerRef = request.headers.get('x-customer-ref') || 'demo_user';
    const result = await thingsService.deleteThing({
      id: params.id,
      auth: { customer_ref: customerRef }
    });
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}`
};

// Create the files
Object.entries(routes).forEach(([filePath, content]) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content);
  console.log(`Created ${filePath}`);
});

console.log('All route files restored!');
