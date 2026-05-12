// /api/pipeline/refresh-pricing — Lightweight midday refresh.
// Runs SeatGeek pricing fetch + rescore for every active city, AND
// triggers post-game refresh: any game whose start_time + 4h grace has
// passed gets marked completed, and dependent upcoming games in the
// same series are immediately re-enriched. The full pipeline (twice
// daily) does the heavy work; this runs four times a day in between
// to keep playoff series copy fresh within ~4h of a game ending.
//
// GET: Vercel Cron trigger (CRON_SECRET header)
// POST: Manual trigger (PIPELINE_SECRET header)

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { attachSeatGeekPricingForCity } from '@/lib/pipeline/espn-events';
import { rescoreAllGames } from '@/lib/pipeline/rescore';
import { enrichSingleGame } from '@/lib/pipeline/enrich';
import { markCompletedAndRefreshDependents } from '@/lib/pipeline/post-game';

export const maxDuration = 300; // 5 min timeout — pricing fetches are I/O-bound

async function refreshPricing() {
  const startedAt = new Date().toISOString();
  const supabase = createServiceClient();

  // Post-game refresh FIRST: mark just-completed games and re-enrich
  // dependent series games. Typically a no-op (no games just finished),
  // but cheap to check on every run and the only mechanism that keeps
  // playoff dependent-game copy fresh between full pipeline runs.
  const postGame = await markCompletedAndRefreshDependents(supabase, enrichSingleGame);
  console.log(`[refresh-pricing] post-game: ${postGame.marked_completed} completed, ${postGame.dependents_refreshed} dependents re-enriched`);

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
    // tokens_used true ONLY if the post-game step actually fired
    // re-enrichments; pricing + rescore are pure infra calls.
    tokens_used: postGame.dependents_refreshed > 0,
    post_game: postGame,
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
