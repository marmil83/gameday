// Pipeline Orchestrator
// Runs the full automated workflow: ingest -> scrape -> enrich -> rank

import { createServiceClient } from '../supabase/server';
import { ingestESPNEventsForCity, attachSeatGeekPricingForCity } from './espn-events';
import { ingestEventsForCity } from './events';
import { scrapePromotionsForCity, closeBrowserPool } from './promotions';
import { enrichGamesForCity, enrichSingleGame } from './enrich';
import { updateStandings } from './standings';
import { rescoreAllGames } from './rescore';
import { markCompletedAndRefreshDependents } from './post-game';

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

  // Step 0a: Mark past scheduled games as completed (4-hour grace for in-progress
  // games), AND immediately re-enrich any dependent upcoming games in the same
  // series. This is what unsticks copy like "Cleveland faces elimination" the
  // moment we know the prior game's outcome — without it, the dependent game's
  // verdict stays stale until the next full pipeline run (up to ~12h).
  console.log(`[Pipeline] Step 0a: Marking past games completed + refreshing dependents`);
  const postGame = await markCompletedAndRefreshDependents(supabase, enrichSingleGame);
  console.log(`[Pipeline] Marked ${postGame.marked_completed} game(s) completed, re-enriched ${postGame.dependents_refreshed} dependent game(s)`);
  if (postGame.errors.length > 0) allErrors.push(...postGame.errors);

  // Step 0b: Update team standings (wins/losses/streak) so scoring is accurate.
  // Runs once per full pipeline invocation — all cities share the same teams table,
  // so this is a global refresh regardless of which city triggered the run.
  console.log(`[Pipeline] Step 0b: Updating team standings`);
  const standingsResult = await updateStandings();
  if (standingsResult.errors.length > 0) allErrors.push(...standingsResult.errors);

  // Step 1a: Ingest major-league games from ESPN (source of truth for opponent/date/time)
  // Window: 5 days. Public site only renders today + next 2 days; the extra
  // 2 days are a buffer so a delayed pipeline run never leaves the visible
  // window unenriched. Was 14 — dropping cuts Sonnet enrichment volume ~64%.
  console.log(`[Pipeline] Step 1a: Ingesting ESPN events for city ${cityId}`);
  const espnResult = await ingestESPNEventsForCity(cityId, 5);
  allErrors.push(...espnResult.errors);
  console.log(`[Pipeline] ESPN: ${espnResult.found} found, ${espnResult.inserted} inserted, ${espnResult.migrated} migrated, ${espnResult.updated} updated`);

  // Step 1b: Attach SeatGeek pricing to ESPN game rows (ticket links + prices)
  console.log(`[Pipeline] Step 1b: Attaching SeatGeek pricing for city ${cityId}`);
  await attachSeatGeekPricingForCity(cityId, 5);

  // Step 1c: Ingest minor-league games from SeatGeek (not on ESPN)
  console.log(`[Pipeline] Step 1c: Ingesting minor-league events for city ${cityId}`);
  const minorResult = await ingestEventsForCity(cityId);
  allErrors.push(...minorResult.errors);

  const eventResult = {
    found: espnResult.found + minorResult.found,
    inserted: espnResult.inserted + minorResult.inserted,
    errors: [...espnResult.errors, ...minorResult.errors],
  };

  // Step 2: Scrape promotions for the next 5 days (matches ingestion window).
  // Dates are generated in the CITY's local timezone — promo pages list dates
  // as the team writes them (always local), so we must match in the same frame.
  console.log(`[Pipeline] Step 2: Scraping promotions for city ${cityId}`);
  let totalPromoExtracted = 0;
  const promoErrors: string[] = [];
  const { data: cityRow } = await supabase.from('cities').select('timezone').eq('id', cityId).single();
  const cityTz = cityRow?.timezone || 'America/New_York';
  const localFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: cityTz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  for (let i = 0; i < 5; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = localFmt.format(d); // local YYYY-MM-DD for this city
    const result = await scrapePromotionsForCity(cityId, dateStr);
    totalPromoExtracted += result.total_extracted;
    promoErrors.push(...result.errors);
  }
  const promoResult = { total_extracted: totalPromoExtracted, errors: promoErrors };
  allErrors.push(...promoResult.errors);

  // Step 3: Enrich games (AI + scoring).
  // CRITICAL ordering: this MUST run after Step 2 (promo scrape) so the
  // AI-written verdict / why_worth_it / promo_clarity reflect the
  // freshly-attached promos. Decoupling these (e.g. running promo scrape
  // standalone) leaves the verdict text referencing whatever promo was
  // attached at the time of the last enrichment — usually wrong by a day.
  console.log(`[Pipeline] Step 3: Enriching games for city ${cityId}`);
  const enrichResult = await enrichGamesForCity(cityId);
  allErrors.push(...enrichResult.errors);

  // Step 4: Rescore all games with latest pricing, standings, and enrichment flags
  // Runs after enrichment so playoff context_flags are immediately reflected in scores
  console.log(`[Pipeline] Step 4: Rescoring all games`);
  const rescoreResult = await rescoreAllGames();
  allErrors.push(...rescoreResult.errors);

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
  try {
    for (const city of cities) {
      const result = await runPipelineForCity(city.id);
      results.push(result);
    }
  } finally {
    // Close the puppeteer browser pool exactly once per full run, after
    // every city has had its turn. Keeping Chrome alive across cities
    // (Detroit → Portland → LA in our case) lets all puppeteer scrapes
    // share one launch instead of paying ~3-5s per JS-rendered URL.
    await closeBrowserPool();
  }

  return results;
}
