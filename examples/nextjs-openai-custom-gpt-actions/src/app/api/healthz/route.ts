import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const memUsage = process.memoryUsage();
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external
    },
    version: process.env.npm_package_version || '1.0.0'
  });
}
