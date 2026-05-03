// /api/pipeline/rescore — Recalculate deal scores without AI tokens
// GET: Vercel Cron trigger (CRON_SECRET header)
// POST: Manual trigger

import { NextRequest, NextResponse } from 'next/server';
import { rescoreAllGames } from '@/lib/pipeline/rescore';

export const maxDuration = 120; // 2 min timeout

// GET — called by Vercel Cron
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Cron] Starting rescore (no AI tokens)');
  const result = await rescoreAllGames();
  console.log(`[Cron] Rescored ${result.rescored} games, ${result.errors.length} errors`);

  return NextResponse.json({
    triggered_at: new Date().toISOString(),
    tokens_used: false,
    ...result,
  });
}

// POST — manual trigger
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const pipelineSecret = process.env.PIPELINE_SECRET;

  if (authHeader !== `Bearer ${pipelineSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await rescoreAllGames();
  return NextResponse.json({ tokens_used: false, ...result });
}
