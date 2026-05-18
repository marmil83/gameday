// /api/pipeline/scrape-tickpick — Cron-driven TickPick price refresh.
//
// Per-city invocation (?city=<name>) so each city fits inside Vercel's
// 5-min serverless budget. Without the per-city split, scraping every
// team across 4 cities sequentially in one function would routinely
// time out — same architectural pattern we adopted for /api/pipeline/run.
//
// GET: Vercel Cron (CRON_SECRET header)
// POST: manual trigger (PIPELINE_SECRET header or admin session)

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';
import { scrapeTickPickForCity } from '@/lib/pipeline/tickpick';
import { closeBrowserPool } from '@/lib/pipeline/promotions';

export const maxDuration = 300; // 5 min — matches /api/pipeline/run

async function runForCity(cityName: string) {
  const supabase = createServiceClient();
  const { data: city } = await supabase
    .from('cities')
    .select('id, name')
    .ilike('name', cityName)
    .single();
  if (!city) {
    return NextResponse.json({ error: `City not found: ${cityName}` }, { status: 404 });
  }
  console.log(`[TickPick Cron] Scraping for ${city.name}`);
  try {
    const result = await scrapeTickPickForCity(city.id);
    console.log(`[TickPick Cron] ${city.name}: ${result.teams_scraped} teams scraped, ${result.prices_saved} prices saved`);
    return NextResponse.json({
      triggered_at: new Date().toISOString(),
      city: city.name,
      ...result,
    });
  } finally {
    // Close shared puppeteer browser. Future invocations relaunch.
    await closeBrowserPool();
  }
}

// GET — Vercel Cron
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cityName = request.nextUrl.searchParams.get('city');
  if (!cityName) {
    return NextResponse.json({ error: 'Missing required ?city= parameter' }, { status: 400 });
  }
  return runForCity(cityName);
}

// POST — manual trigger (admin or PIPELINE_SECRET)
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const pipelineSecret = process.env.PIPELINE_SECRET;
  if (authHeader !== `Bearer ${pipelineSecret}`) {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }
  const body = await request.json().catch(() => ({}));
  const cityName = (body as { city?: string }).city;
  if (!cityName) {
    return NextResponse.json({ error: 'Missing required body.city' }, { status: 400 });
  }
  return runForCity(cityName);
}
