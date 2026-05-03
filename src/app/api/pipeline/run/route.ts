// /api/pipeline/run — Trigger the pipeline
// POST: manual trigger (admin session or pipeline secret)
// GET: Vercel Cron trigger (CRON_SECRET header)

import { NextRequest, NextResponse } from 'next/server';
import { runPipelineForCity, runFullPipeline } from '@/lib/pipeline/orchestrator';
import { createServiceClient } from '@/lib/supabase/server';

export const maxDuration = 300; // 5 min timeout for cron

// GET — called by Vercel Cron
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('[Cron] Starting full pipeline run');
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
    const supabase = createServiceClient();
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

    const result = await runPipelineForCity(city.id);
    return NextResponse.json(result);
  }

  const results = await runFullPipeline();
  return NextResponse.json({ results });
}
