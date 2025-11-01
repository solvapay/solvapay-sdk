import { NextRequest, NextResponse } from 'next/server';
import { getAllThings } from '@/lib/storage-adapter';

/**
 * Debug endpoint to check things storage status
 */
export async function GET() {
  console.log('🔍 [DEBUG] ===== Things Debug =====');
  
  const things = await getAllThings();
  console.log('🔍 [DEBUG] Loaded things:', things);
  
  return NextResponse.json({ 
    things,
    storage: process.env.VERCEL ? 'Vercel KV' : 'Local File',
    count: Object.keys(things).length
  });
}
