// /api/pipeline/run — Trigger the pipeline
// POST: manual trigger (admin session or pipeline secret)
// GET: Vercel Cron trigger (CRON_SECRET header)

import { NextRequest, NextResponse } from 'next/server';
import { runPipelineForCity, runFullPipeline } from '@/lib/pipeline/orchestrator';
import { closeBrowserPool } from '@/lib/pipeline/promotions';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 300; // 5 min timeout for cron

// GET — called by Vercel Cron
//
// Accepts an optional `?city=<name>` query param so each city can be
// scheduled as its own cron entry. Without that split, all three cities
// ran sequentially inside a single function invocation and routinely
// hit Vercel's 5-min maxDuration — Detroit alone can eat ~5 min on a
// Tigers-heavy day, leaving Portland or LA stuck in `running` state
// forever. With per-city crons, each city gets its own 5-min budget.
//
// Falls back to runFullPipeline() when no city param is provided so
// the legacy single-cron config keeps working during transition.
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const cityName = request.nextUrl.searchParams.get('city');

  if (cityName) {
    const supabase = createServiceClient();
    const { data: city } = await supabase
      .from('cities')
      .select('id, name')
      .ilike('name', cityName)
      .single();
    if (!city) {
      return NextResponse.json({ error: `City not found: ${cityName}` }, { status: 404 });
    }
    console.log(`[Cron] Starting pipeline run for ${city.name}`);
    try {
      const result = await runPipelineForCity(city.id);
      console.log(`[Cron] Pipeline complete for ${city.name}: ${result.status}`);
      return NextResponse.json({
        triggered_at: new Date().toISOString(),
        result,
      });
    } finally {
      // runPipelineForCity (single-city branch) doesn't close the
      // browser pool — runFullPipeline does. Close it here so the
      // per-city function exits cleanly.
      await closeBrowserPool();
    }
  }

  console.log('[Cron] Starting full pipeline run (no city param — legacy path)');
  const results = await runFullPipeline();
  console.log('[Cron] Pipeline complete:', results.length, 'cities processed');

  return NextResponse.json({
    triggered_at: new Date().toISOString(),
    results,
  });
}

// POST — manual trigger from admin or pipeline secret
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const pipelineSecret = process.env.PIPELINE_SECRET;

  if (authHeader !== `Bearer ${pipelineSecret}`) {
    // Must use the cookie-reading server client here — createServiceClient()
    // uses the service role key and won't see the admin's session cookie,
    // so auth.getUser() always returned null and 401'd a logged-in admin
    // clicking "Run Pipeline" from the dashboard.
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const cityName = body.city;

  if (cityName) {
    const supabase = createServiceClient();
    const { data: city } = await supabase
      .from('cities')
      .select('id')
      .ilike('name', cityName)
      .single();

    if (!city) {
      return NextResponse.json({ error: 'City not found' }, { status: 404 });
    }

    try {
      const result = await runPipelineForCity(city.id);
      return NextResponse.json(result);
    } finally {
      // runFullPipeline closes its own pool, but the single-city branch
      // doesn't go through that wrapper — so we have to close here too.
      await closeBrowserPool();
    }
  }

  const results = await runFullPipeline();
  return NextResponse.json({ results });
}
