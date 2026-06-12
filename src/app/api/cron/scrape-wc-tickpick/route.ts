// GET /api/cron/scrape-wc-tickpick
//
// Scrapes TickPick's WC catalog and writes per-match pricing snapshots
// for our seeded NY/LA games. Runs ~daily — TickPick inventory churns
// slowly enough that hourly would be overkill, and the puppeteer pass
// is heavier than the regular pricing refresh so we don't want it on
// the 4×/day schedule.
//
// Auth: PIPELINE_SECRET via Authorization: Bearer header (matches the
// pattern used by the other pipeline cron routes).

import { NextRequest, NextResponse } from 'next/server';
import { scrapeWCTickPick } from '@/lib/pipeline/wc-tickpick';
import { closeBrowserPool } from '@/lib/pipeline/promotions';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 min — puppeteer scroll loop is ~30-60s

export async function GET(req: NextRequest) {
  const pipelineSecret = process.env.PIPELINE_SECRET;
  if (pipelineSecret) {
    const auth = req.headers.get('authorization') || '';
    const ok = auth === `Bearer ${pipelineSecret}`;
    if (!ok) return new Response('Unauthorized', { status: 401 });
  }

  const startedAt = new Date().toISOString();

  try {
    const result = await scrapeWCTickPick();
    return NextResponse.json({
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, started_at: startedAt },
      { status: 500 },
    );
  } finally {
    // Always close the browser so a one-off serverless invocation doesn't
    // leak Chrome into the next cold start.
    await closeBrowserPool();
  }
}
