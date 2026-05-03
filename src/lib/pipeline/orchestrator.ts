// Pipeline Orchestrator
// Runs the full automated workflow: ingest -> scrape -> enrich -> rank

import { createServiceClient } from '../supabase/server';
import { ingestEventsForCity } from './events';
import { scrapePromotionsForCity } from './promotions';
import { enrichGamesForCity } from './enrich';

interface PipelineResult {
  run_id: string;
  city_id: string;
  status: 'completed' | 'partial' | 'failed';
  events: { found: number; inserted: number };
  promotions: { extracted: number };
  enrichment: { enriched: number };
  errors: string[];
  duration_ms: number;
}

/**
 * Run the full pipeline for a single city
 */
export async function runPipelineForCity(cityId: string): Promise<PipelineResult> {
  const supabase = createServiceClient();
  const startTime = Date.now();
  const allErrors: string[] = [];

  // Create pipeline run record
  const { data: run } = await supabase
    .from('pipeline_runs')
    .insert({
      run_type: 'full',
      city_id: cityId,
      status: 'running',
    })
    .select('id')
    .single();

  const runId = run?.id || 'unknown';

  // Step 1: Ingest events
  console.log(`[Pipeline] Step 1: Ingesting events for city ${cityId}`);
  const eventResult = await ingestEventsForCity(cityId);
  allErrors.push(...eventResult.errors);

  // Step 2: Scrape promotions
  console.log(`[Pipeline] Step 2: Scraping promotions for city ${cityId}`);
  const today = new Date().toISOString().split('T')[0];
  const promoResult = await scrapePromotionsForCity(cityId, today);
  allErrors.push(...promoResult.errors);

  // Step 3: Enrich games (AI + scoring)
  console.log(`[Pipeline] Step 3: Enriching games for city ${cityId}`);
  const enrichResult = await enrichGamesForCity(cityId);
  allErrors.push(...enrichResult.errors);

  const duration = Date.now() - startTime;
  const status = allErrors.length === 0 ? 'completed'
    : enrichResult.enriched > 0 ? 'partial'
    : 'failed';

  // Update pipeline run record
  await supabase
    .from('pipeline_runs')
    .update({
      status,
      games_found: eventResult.found,
      games_enriched: enrichResult.enriched,
      errors: allErrors,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId);

  console.log(`[Pipeline] Completed in ${duration}ms — ${status}`);

  return {
    run_id: runId,
    city_id: cityId,
    status,
    events: { found: eventResult.found, inserted: eventResult.inserted },
    promotions: { extracted: promoResult.total_extracted },
    enrichment: { enriched: enrichResult.enriched },
    errors: allErrors,
    duration_ms: duration,
  };
}

/**
 * Run the pipeline for all active cities
 */
export async function runFullPipeline(): Promise<PipelineResult[]> {
  const supabase = createServiceClient();

  const { data: cities } = await supabase
    .from('cities')
    .select('id')
    .eq('is_active', true);

  if (!cities) return [];

  const results: PipelineResult[] = [];
  for (const city of cities) {
    const result = await runPipelineForCity(city.id);
    results.push(result);
  }

  return results;
}
