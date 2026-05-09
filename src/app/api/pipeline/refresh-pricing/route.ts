// /api/pipeline/refresh-pricing — Lightweight midday pricing refresh.
// Runs SeatGeek pricing fetch + rescore for every active city.
// Skips ESPN ingestion, promo scraping, and AI enrichment to keep
// costs near zero — those happen in the full pipeline (twice daily).
//
// GET: Vercel Cron trigger (CRON_SECRET header)
// POST: Manual trigger (PIPELINE_SECRET header)

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { attachSeatGeekPricingForCity } from '@/lib/pipeline/espn-events';
import { rescoreAllGames } from '@/lib/pipeline/rescore';

export const maxDuration = 300; // 5 min timeout — pricing fetches are I/O-bound

async function refreshPricing() {
  const startedAt = new Date().toISOString();
  const supabase = createServiceClient();

  const { data: cities } = await supabase
    .from('cities')
    .select('id, name')
    .eq('is_active', true);

  const cityResults: Array<{ city: string; status: 'ok' | 'failed'; error?: string }> = [];

  for (const city of cities || []) {
    try {
      console.log(`[refresh-pricing] SeatGeek for ${city.name}`);
      await attachSeatGeekPricingForCity(city.id, 14);
      cityResults.push({ city: city.name, status: 'ok' });
    } catch (err) {
      cityResults.push({ city: city.name, status: 'failed', error: String(err) });
    }
  }

  console.log('[refresh-pricing] Rescoring all games with fresh pricing');
  const rescore = await rescoreAllGames();

  return {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    tokens_used: false,
    cities: cityResults,
    rescored: rescore.rescored,
    rescore_errors: rescore.errors,
  };
}

// GET — Vercel Cron
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await refreshPricing();
  return NextResponse.json(result);
}

// POST — manual trigger
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const pipelineSecret = process.env.PIPELINE_SECRET;
  if (authHeader !== `Bearer ${pipelineSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await refreshPricing();
  return NextResponse.json(result);
}
