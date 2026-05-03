// Enrichment Pipeline
// Orchestrates AI enrichment, scoring, and ranking for games

import { createServiceClient } from '../supabase/server';
import { enrichGame } from '../ai/claude';
import { calculateDealScore } from '../scoring/deal-score';
import { getWeatherForGame } from './weather';
import { LEAGUE_AVG_PRICES, GAMES_PER_CITY } from '../constants';
import type { Game, PricingSnapshot, Promotion } from '@/types/database';

/**
 * Get the latest pricing snapshot for a game
 */
async function getLatestPricing(gameId: string): Promise<PricingSnapshot | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('pricing_snapshots')
    .select('*')
    .eq('game_id', gameId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();
  return data as PricingSnapshot | null;
}

/**
 * Get promotions for a game
 */
async function getPromotions(gameId: string): Promise<Promotion[]> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('promotions')
    .select('*')
    .eq('game_id', gameId);
  return (data || []) as Promotion[];
}

/**
 * Enrich a single game with AI insights, scores, and tags
 */
export async function enrichSingleGame(gameId: string): Promise<void> {
  const supabase = createServiceClient();

  const { data: game } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single();

  if (!game) return;

  const pricing = await getLatestPricing(gameId);
  const promotions = await getPromotions(gameId);

  const startTime = new Date(game.start_time);

  // Get city timezone for accurate local time formatting
  const { data: city } = await supabase
    .from('cities')
    .select('timezone')
    .eq('id', game.city_id)
    .single();
  const tz = city?.timezone || 'America/New_York';

  // Get home team info (venue type + standings)
  const { data: homeTeam } = await supabase
    .from('teams')
    .select('venue_type, wins, losses, win_pct, streak')
    .eq('id', game.home_team_id)
    .single();

  const isOutdoor = homeTeam?.venue_type === 'outdoor';

  // Get away team standings (may not exist if team isn't in our DB)
  const { data: awayTeam } = await supabase
    .from('teams')
    .select('wins, losses, win_pct, streak')
    .eq('name', game.away_team_name)
    .single();

  // Fetch weather for outdoor venues
  let weatherScore: number | undefined;
  if (isOutdoor) {
    const weather = await getWeatherForGame(game.venue, game.start_time);
    if (weather) {
      weatherScore = weather.weather_score;
      // Save weather data to game_insights later
      await supabase.from('game_insights').upsert({
        game_id: gameId,
        weather_temp_f: weather.temp_f,
        weather_condition: weather.condition,
        weather_icon: weather.icon,
        weather_score: weather.weather_score,
      }, { onConflict: 'game_id' });
    }
  }

  // Compute game quality from standings
  const homePct = Number(homeTeam?.win_pct) || 0;
  const awayPct = awayTeam ? (Number(awayTeam.win_pct) || 0) : 0.5;
  const hasStandings = homeTeam?.wins != null && (homeTeam.wins > 0 || homeTeam.losses > 0);
  let teamQuality: number | undefined;
  if (hasStandings) {
    const avgPct = (homePct + awayPct) / 2;
    // Convert avg win% to 0-10 scale: .500 = 5, .600 = 7, .400 = 3
    teamQuality = 5 + (avgPct - 0.5) * 20;
    // Competitive matchup bonus
    const pctDiff = Math.abs(homePct - awayPct);
    if (pctDiff < 0.1) teamQuality += 1;
    else if (pctDiff > 0.25) teamQuality -= 0.5;
    // Streak bonus
    const streak = homeTeam.streak || '';
    const streakNum = parseInt(streak.replace(/\D/g, '')) || 0;
    if (streak.startsWith('W') && streakNum >= 3) teamQuality += 1;
    teamQuality = Math.max(0, Math.min(10, teamQuality));
  }

  // 1. AI Enrichment
  const enrichment = await enrichGame({
    homeTeam: game.home_team_name,
    awayTeam: game.away_team_name,
    league: game.league,
    venue: game.venue,
    startTime: startTime.toLocaleString('en-US', {
      timeZone: tz,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    dayOfWeek: startTime.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' }),
    lowestPrice: pricing?.lowest_price ?? null,
    avgLeaguePrice: LEAGUE_AVG_PRICES[game.league] || 40,
    pricingTransparency: pricing?.pricing_transparency || 'unknown',
    promotions: promotions.map(p => ({
      type: p.promo_type || 'unknown',
      item: p.promo_item,
      description: p.promo_description || '',
    })),
    isOutdoor,
  });

  // 2. Calculate Deal Score (rules-based)
  const scoreResult = calculateDealScore({
    game: game as Game,
    pricing,
    promotions,
    isOutdoor,
    weatherScore,
    teamQuality,
    timezone: tz,
  });

  // 3. Save score
  await supabase.from('scores').upsert({
    game_id: gameId,
    ...scoreResult,
  }, { onConflict: 'game_id' });

  // 4. Save insights
  await supabase.from('game_insights').upsert({
    game_id: gameId,
    expectation_summary: enrichment.expectation_summary,
    target_audience: enrichment.target_audience,
    effort_level: enrichment.effort_level,
    price_insight: enrichment.price_insight,
    promo_clarity: enrichment.promo_clarity,
    seat_expectation: enrichment.seat_expectation,
    context_flags: enrichment.context_flags,
    verdict: enrichment.verdict,
    why_worth_it: enrichment.why_worth_it,
    confidence_score: 0.8,
  }, { onConflict: 'game_id' });

  // 5. Save vibe tags
  // Clear existing AI tags first
  await supabase
    .from('tags')
    .delete()
    .eq('game_id', gameId)
    .eq('source_type', 'ai');

  for (const tag of enrichment.vibe_tags) {
    await supabase.from('tags').upsert({
      game_id: gameId,
      tag_name: tag,
      source_type: 'ai',
      confidence_score: 0.85,
    }, { onConflict: 'game_id,tag_name' });
  }

  // 6. Mark game as enriched
  await supabase
    .from('games')
    .update({ pipeline_status: 'enriched' })
    .eq('id', gameId);
}

/**
 * Enrich all pending games for a city
 */
export async function enrichGamesForCity(cityId: string): Promise<{
  enriched: number;
  errors: string[];
}> {
  const supabase = createServiceClient();
  const errors: string[] = [];

  const { data: games } = await supabase
    .from('games')
    .select('id')
    .eq('city_id', cityId)
    .eq('status', 'scheduled')
    .in('pipeline_status', ['pending', 'enriched'])
    .gte('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(20);

  if (!games || games.length === 0) {
    return { enriched: 0, errors: [] };
  }

  let enriched = 0;
  for (const game of games) {
    try {
      await enrichSingleGame(game.id);
      enriched++;
    } catch (error) {
      errors.push(`Failed to enrich game ${game.id}: ${error}`);
    }
  }

  return { enriched, errors };
}

/**
 * Get the top-ranked games for a city today
 */
export async function getTopGamesForCity(
  cityId: string,
  date?: string, // YYYY-MM-DD, defaults to today
  limit: number = GAMES_PER_CITY,
  timezone?: string,
) {
  const supabase = createServiceClient();
  const tz = timezone || 'America/New_York';

  const targetDate = date || new Date().toLocaleDateString('en-CA', { timeZone: tz });

  // Convert local date boundaries to UTC using the city's timezone
  // Create a date string at midnight local time, then get its UTC equivalent
  const localMidnight = new Date(`${targetDate}T00:00:00`);
  const localEnd = new Date(`${targetDate}T23:59:59.999`);

  // Get UTC offset by formatting in the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Use a simpler approach: construct a Date that represents midnight in the target timezone
  // by using toLocaleString to find the offset
  const nowInTz = new Date().toLocaleString('en-US', { timeZone: tz });
  const nowUtc = new Date();
  const nowLocal = new Date(nowInTz);
  const offsetMs = nowUtc.getTime() - nowLocal.getTime();

  // dayStart/dayEnd in UTC = local midnight/end + offset
  const dayStartUtc = new Date(localMidnight.getTime() + offsetMs);
  const dayEndUtc = new Date(localEnd.getTime() + offsetMs);

  const dayStart = dayStartUtc.toISOString();
  const dayEnd = dayEndUtc.toISOString();

  const { data: games, error } = await supabase
    .from('games')
    .select(`
      *,
      scores (*),
      tags (*),
      game_insights (*),
      promotions (*),
      pricing_snapshots (*),
      home_team:teams!home_team_id (logo_url),
      away_team:teams!away_team_id (logo_url)
    `)
    .eq('city_id', cityId)
    .eq('status', 'scheduled')
    .eq('is_hidden', false)
    .eq('is_home_game', true)
    .gte('start_time', dayStart)
    .lte('start_time', dayEnd)
    .order('is_featured', { ascending: false });

  if (error || !games) return [];

  // Sort by deal score (featured games first, then by score)
  const sorted = games.sort((a, b) => {
    if (a.is_featured && !b.is_featured) return -1;
    if (!a.is_featured && b.is_featured) return 1;
    const scoreA = (Array.isArray(a.scores) ? a.scores[0]?.deal_score : a.scores?.deal_score) || 0;
    const scoreB = (Array.isArray(b.scores) ? b.scores[0]?.deal_score : b.scores?.deal_score) || 0;
    return scoreB - scoreA;
  });

  return sorted.slice(0, limit).map(game => {
    // Get the latest pricing snapshot
    const latestPricing = game.pricing_snapshots
      ?.sort((a: { captured_at: string }, b: { captured_at: string }) =>
        new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
      )?.[0] || null;

    return {
      game: {
        id: game.id,
        home_team_id: game.home_team_id,
        away_team_id: game.away_team_id,
        home_team_name: game.home_team_name,
        away_team_name: game.away_team_name,
        league: game.league,
        venue: game.venue,
        city_id: game.city_id,
        start_time: game.start_time,
        status: game.status,
        source: game.source,
        source_event_id: game.source_event_id,
        affiliate_url: game.affiliate_url,
        is_home_game: game.is_home_game,
        is_featured: game.is_featured,
        is_hidden: game.is_hidden,
        is_published: game.is_published,
        pipeline_status: game.pipeline_status,
        created_at: game.created_at,
        updated_at: game.updated_at,
      },
      pricing: latestPricing,
      promotions: game.promotions || [],
      score: Array.isArray(game.scores) ? game.scores[0] || null : game.scores || null,
      tags: Array.isArray(game.tags) ? game.tags : game.tags ? [game.tags] : [],
      insights: Array.isArray(game.game_insights) ? game.game_insights[0] || null : game.game_insights || null,
      home_team_logo: (game as any).home_team?.logo_url || null,
      away_team_logo: (game as any).away_team?.logo_url || null,
    };
  });
}
