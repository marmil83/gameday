// Recalculate Deal Scores — NO AI tokens used
// Updates scores using latest pricing, standings, weather, and promos
// Usage: npx tsx scripts/rescore.ts
//
// Run this frequently (e.g. every few hours) to keep scores fresh.
// Only run enrich.ts when games are first added or promos change.

import { createClient } from '@supabase/supabase-js';
import { getWeatherForGame } from '../src/lib/pipeline/weather';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const LEAGUE_AVG_PRICES: Record<string, number> = {
  MLB: 35, NBA: 55, NHL: 60, NFL: 120, MLS: 35, NWSL: 25, WNBA: 40,
  'MiLB-AAA': 15, 'MiLB-AA': 12, 'MiLB-A+': 10, AHL: 20, USL: 18, WHL: 15,
};

const PLAYOFF_AVG_PRICES: Record<string, Partial<Record<string, number>>> = {
  NBA: { 'first-round': 150, 'conference-semis': 200, 'conference-finals': 350, 'finals': 650 },
  NHL: { 'first-round': 120, 'conference-semis': 180, 'conference-finals': 300, 'finals': 550 },
  MLB: { 'first-round': 100, 'conference-semis': 130, 'conference-finals': 220, 'finals': 550 },
  NFL: { 'first-round': 300, 'conference-semis': 500, 'conference-finals': 750, 'finals': 1200 },
  AHL: { 'first-round': 60, 'conference-semis': 80, 'conference-finals': 110, 'finals': 150 },
};

function getPriceBaseline(league: string, playoffRound?: string | null): number {
  if (playoffRound) {
    const roundAvg = PLAYOFF_AVG_PRICES[league]?.[playoffRound];
    if (roundAvg) return roundAvg;
  }
  return LEAGUE_AVG_PRICES[league] ?? 40;
}

const KNOWN_PLAYOFF_ROUNDS = ['first-round', 'conference-semis', 'conference-finals', 'finals'] as const;

// IMPORTANT: keep these in sync with src/lib/constants.ts.
// Standalone scripts can't share the @/lib path alias reliably, so we mirror values here.
// If you change weights or experience baselines, update BOTH locations.
const DEAL_SCORE_WEIGHTS = { price: 0.4, experience: 0.2, game_quality: 0.2, timing: 0.1, context: 0.1 };
const PLAYOFF_DEAL_SCORE_WEIGHTS = { price: 0.25, experience: 0.25, game_quality: 0.25, timing: 0.10, context: 0.15 };
const PLAYOFF_EXPERIENCE_BASELINE = 4.0;
const ELIMINATION_EXPERIENCE_BASELINE = 5.5;
function getDealScoreWeights(isPlayoffs?: boolean) {
  return isPlayoffs ? PLAYOFF_DEAL_SCORE_WEIGHTS : DEAL_SCORE_WEIGHTS;
}

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
function round(v: number, d = 2) { return Math.round(v * 10 ** d) / 10 ** d; }

function calcPriceScore(league: string, lowestPrice: number | null, playoffRound?: string | null) {
  if (!lowestPrice) return { score: 5, reasoning: 'No pricing data' };
  const avg = getPriceBaseline(league, playoffRound);
  const ratio = lowestPrice / avg;
  let score = ratio <= 0.25 ? 10 : ratio <= 0.5 ? 8 + (0.5 - ratio) * 8 : ratio <= 1 ? 5 + (1 - ratio) * 6 : ratio <= 1.5 ? 3 + (1.5 - ratio) * 4 : ratio <= 2 ? 1 + (2 - ratio) * 4 : 1;
  const marketLabel = playoffRound ? 'playoff avg' : 'typical';
  const reasoning = ratio < 0.7
    ? `Great value at $${lowestPrice} (${marketLabel}: $${avg})`
    : ratio < 1.1
      ? `Fair price at $${lowestPrice} (${marketLabel}: $${avg})`
      : `Above average at $${lowestPrice} (${marketLabel}: $${avg})`;
  return { score: clamp(round(score), 0, 10), reasoning };
}

function calcTimingScore(startTime: string, timezone?: string, isPlayoffs?: boolean) {
  const d = new Date(startTime);
  let day: number;
  let hour: number;
  if (timezone) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'short', hour: 'numeric', hour12: false,
    }).formatToParts(d);
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    day = dayMap[parts.find(p => p.type === 'weekday')?.value || ''] ?? d.getDay();
    hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
    if (hour === 24) hour = 0;
  } else {
    day = d.getDay();
    hour = d.getHours();
  }
  let score = 5;
  const factors: string[] = [];
  if (day === 0 || day === 6) { score += 2; factors.push('weekend'); }
  else if (day === 5) { score += 1.5; factors.push('Friday'); }
  if (hour >= 17 && hour <= 19) { score += 1.5; factors.push('evening start'); }
  else if (hour >= 12 && hour <= 15) { score += 1; factors.push('daytime game'); }
  else if (hour >= 20) { score -= 0.5; factors.push('late start'); }
  // Playoff weeknight boost — people rearrange their schedule for playoffs
  if (isPlayoffs && day >= 1 && day <= 4) { score += 1; factors.push('playoff weeknight'); }
  return { score: clamp(round(score), 0, 10), reasoning: factors.join(', ') || 'Weeknight game' };
}

function calcExperienceScore(promos: any[], isPlayoffs?: boolean, isElimination?: boolean) {
  // Playoff baseline — sourced from constants block above; mirrors src/lib/constants.ts
  const playoffBaseline = isElimination ? ELIMINATION_EXPERIENCE_BASELINE : isPlayoffs ? PLAYOFF_EXPERIENCE_BASELINE : 0;

  if (!promos || promos.length === 0) {
    const reasoning = isElimination
      ? 'Playoff atmosphere — expect giveaways and electric crowd'
      : isPlayoffs
        ? 'Playoff atmosphere — elevated energy and likely giveaways'
        : 'No promotions detected';
    return { score: clamp(3 + playoffBaseline, 0, 10), reasoning };
  }

  let score = 3 + playoffBaseline;
  const highlights: string[] = [];
  for (const p of promos) {
    switch (p.promo_type) {
      case 'giveaway': score += 3; highlights.push(p.promo_item || 'giveaway'); break;
      case 'fireworks': score += 2.5; highlights.push('fireworks'); break;
      case 'theme_night': score += 2; highlights.push('theme night'); break;
      case 'family_promo': score += 1.5; highlights.push('family promo'); break;
      case 'food_bev_promo': score += 1.5; highlights.push('food/drink deal'); break;
      case 'special_ticket': score += 1; highlights.push('special ticket package'); break;
      default: score += 1;
    }
  }
  return {
    score: clamp(round(score), 0, 10),
    reasoning: highlights.length > 0
      ? (isPlayoffs ? `Playoff + ${highlights.join(', ')}` : `Includes: ${highlights.join(', ')}`)
      : 'Standard game experience',
  };
}

interface TeamStandings {
  wins: number;
  losses: number;
  win_pct: number;
  streak: string | null;
  last_10_wins?: number | null;
  last_10_losses?: number | null;
  ties?: number | null;
}

function last10Pct(t: TeamStandings | null | undefined): number | null {
  if (!t || t.last_10_wins == null || t.last_10_losses == null) return null;
  const total = t.last_10_wins + t.last_10_losses;
  return total > 0 ? t.last_10_wins / total : null;
}

function calcGameQuality(
  homeTeam: TeamStandings | null,
  awayTeam: TeamStandings | null,
) {
  if (!homeTeam || (!homeTeam.wins && !homeTeam.losses)) {
    return { score: 5, reasoning: 'No standings data' };
  }

  let score = 5;
  const factors: string[] = [];

  const homePct = Number(homeTeam.win_pct) || 0;
  const awayPct = awayTeam ? (Number(awayTeam.win_pct) || 0) : 0.5;

  // Sample-size guard: ignore standings math during early-season noise.
  // Ties counted for soccer (MLS/NWSL).
  const homeGames = (homeTeam.wins || 0) + (homeTeam.losses || 0) + (homeTeam.ties || 0);
  const awayGames = awayTeam ? (awayTeam.wins || 0) + (awayTeam.losses || 0) + (awayTeam.ties || 0) : 10;
  const smallSample = homeGames < 10 || awayGames < 10;

  if (!smallSample) {
    const avgPct = (homePct + awayPct) / 2;
    score += (avgPct - 0.5) * 5;
    if (avgPct >= 0.55) factors.push('both teams competitive');
    if (avgPct < 0.4) factors.push('both teams struggling');

    const pctDiff = Math.abs(homePct - awayPct);
    if (pctDiff < 0.1) { score += 1; factors.push('evenly matched'); }
    else if (pctDiff > 0.25) { score -= 0.5; factors.push('lopsided matchup'); }
  } else {
    factors.push('early season — quality TBD');
  }

  const homeL10 = last10Pct(homeTeam);
  const awayL10 = last10Pct(awayTeam);
  const homeL10Total = (homeTeam.last_10_wins ?? 0) + (homeTeam.last_10_losses ?? 0);
  const awayL10Total = (awayTeam?.last_10_wins ?? 0) + (awayTeam?.last_10_losses ?? 0);
  if (homeL10Total >= 8 && homeL10 != null && homeL10 >= 0.7) { score += 1; factors.push(`home hot (L10: ${homeTeam.last_10_wins}-${homeTeam.last_10_losses})`); }
  else if (homeL10Total >= 8 && homeL10 != null && homeL10 <= 0.3) { score -= 0.5; factors.push(`home cold (L10: ${homeTeam.last_10_wins}-${homeTeam.last_10_losses})`); }
  if (awayL10Total >= 8 && awayL10 != null && awayL10 >= 0.7) { score += 0.5; factors.push('visitor hot'); }

  const homeStreak = homeTeam.streak || '';
  const homeStreakNum = parseInt(homeStreak.replace(/\D/g, '')) || 0;
  if (homeStreak.startsWith('W') && homeStreakNum >= 3) { score += 0.5; factors.push(`home on ${homeStreak}`); }
  if (homeStreak.startsWith('L') && homeStreakNum >= 5) { score -= 0.5; factors.push(`home on ${homeStreak}`); }
  if (homePct >= 0.6) { score += 0.5; factors.push('strong home team'); }

  if (homePct >= 0.6 && awayPct >= 0.6) { score += 1; factors.push('marquee matchup'); }

  const homeRec = homeTeam.wins && homeTeam.losses ? `${homeTeam.wins}-${homeTeam.losses}` : null;
  const awayRec = awayTeam?.wins && awayTeam?.losses ? `${awayTeam.wins}-${awayTeam.losses}` : null;
  const reasoning = [
    homeRec ? `Home: ${homeRec}` : null,
    awayRec ? `Away: ${awayRec}` : null,
    ...factors,
  ].filter(Boolean).join(', ');

  return { score: clamp(round(score), 0, 10), reasoning };
}

async function rescoreGame(game: any) {
  // Get city timezone
  const { data: city } = await supabase.from('cities').select('timezone').eq('id', game.city_id).single();
  const tz = city?.timezone || 'America/New_York';

  // Get team venue type and standings
  const { data: team } = await supabase
    .from('teams')
    .select('venue_type, wins, losses, win_pct, streak, external_ids')
    .eq('id', game.home_team_id)
    .single();

  const isOutdoor = team?.venue_type === 'outdoor';

  // Get best pricing: cheapest non-null price across all sources.
  // A null SeatGeek snapshot (common when events are sold-out or started) must
  // never shadow a real TickPick price captured earlier.
  const { data: pricing } = await supabase
    .from('pricing_snapshots')
    .select('lowest_price')
    .eq('game_id', game.id)
    .not('lowest_price', 'is', null)
    .order('lowest_price', { ascending: true })
    .limit(1)
    .single();

  // Get promotions
  const { data: promos } = await supabase.from('promotions').select('promo_type, promo_item').eq('game_id', game.id);

  // Pull context flags from previous enrichment to preserve playoff detection
  const { data: insights } = await supabase
    .from('game_insights')
    .select('context_flags')
    .eq('game_id', game.id)
    .single();
  const contextFlags: string[] = (insights?.context_flags as string[]) || [];
  const isPlayoffs = contextFlags.includes('playoff') || contextFlags.includes('elimination') || contextFlags.includes('finals');
  const isElimination = contextFlags.includes('elimination') || contextFlags.includes('finals');
  const isOpeningDay = contextFlags.includes('opening-day');
  // Derive playoff round from context_flags — enrich.ts stores the slug directly (e.g. 'conference-semis')
  // If playoff but no round known, default to 'first-round' so we never score against regular season prices
  const detectedRound = KNOWN_PLAYOFF_ROUNDS.find(r => contextFlags.includes(r)) ?? null;
  const playoffRound = detectedRound ?? (isPlayoffs ? 'first-round' : null);

  // Get away team standings
  const { data: awayTeamData } = await supabase
    .from('teams')
    .select('wins, losses, win_pct, streak, external_ids')
    .eq('name', game.away_team_name)
    .single();

  // Fetch weather for outdoor venues
  let weather = null;
  if (isOutdoor) {
    weather = await getWeatherForGame(game.venue, game.start_time);
    if (weather) {
      console.log(`  Weather: ${weather.icon} ${weather.temp_f}°F ${weather.condition} (score: ${weather.weather_score})`);
      // Update weather in game_insights
      await supabase.from('game_insights').upsert({
        game_id: game.id,
        weather_temp_f: weather.temp_f,
        weather_condition: weather.condition,
        weather_icon: weather.icon,
        weather_score: weather.weather_score,
      }, { onConflict: 'game_id' });
    }
  }

  const lowestPrice = pricing?.lowest_price || null;
  type ExtIds = { last_10_wins?: number; last_10_losses?: number; ties?: number };
  const homeExt = (team?.external_ids as ExtIds | null) || null;
  const awayExt = (awayTeamData?.external_ids as ExtIds | null) || null;
  const homeTeamData = team ? {
    wins: team.wins, losses: team.losses, win_pct: team.win_pct, streak: team.streak,
    last_10_wins: homeExt?.last_10_wins ?? null,
    last_10_losses: homeExt?.last_10_losses ?? null,
    ties: homeExt?.ties ?? null,
  } : null;
  const awayTeamForScoring = awayTeamData ? {
    wins: awayTeamData.wins, losses: awayTeamData.losses, win_pct: awayTeamData.win_pct, streak: awayTeamData.streak,
    last_10_wins: awayExt?.last_10_wins ?? null,
    last_10_losses: awayExt?.last_10_losses ?? null,
    ties: awayExt?.ties ?? null,
  } : null;

  // Calculate all sub-scores (pure math, no AI)
  const price = calcPriceScore(game.league, lowestPrice, playoffRound);
  const experience = calcExperienceScore(promos || [], isPlayoffs, isElimination);
  const baseQuality = calcGameQuality(homeTeamData, awayTeamForScoring);
  // Opening Day boost — historic occasion regardless of records
  const openingDayQualityBoost = isOpeningDay ? 2.0 : 0;
  const gameQuality = {
    score: clamp(round(baseQuality.score + openingDayQualityBoost), 0, 10),
    reasoning: isOpeningDay ? `${baseQuality.reasoning}, opening day` : baseQuality.reasoning,
  };
  const timing = calcTimingScore(game.start_time, tz, isPlayoffs);
  // Context score: weather (outdoor) + playoff/opening-day boost
  const baseContextScore = isOutdoor && weather ? weather.weather_score : 5;
  const playoffContextBoost = isElimination ? 5 : isPlayoffs ? 3 : 0;
  const openingDayContextBoost = isOpeningDay ? 1.5 : 0;
  const contextScore = clamp(baseContextScore + playoffContextBoost + openingDayContextBoost, 0, 10);
  const contextReasons = [];
  if (isElimination) contextReasons.push('elimination game');
  else if (isPlayoffs) contextReasons.push('playoff game');
  if (isOpeningDay) contextReasons.push('opening day');
  if (isOutdoor && weather) contextReasons.push(contextScore >= 7 ? 'great weather' : contextScore <= 3 ? 'weather concern' : 'fair weather');
  const context = { score: contextScore, reasoning: contextReasons.join(', ') || 'Standard conditions' };

  // Pick weight profile — playoffs de-emphasize price, boost experience/quality/context
  const weights = getDealScoreWeights(isPlayoffs);

  const dealScore = round(
    price.score * weights.price +
    experience.score * weights.experience +
    gameQuality.score * weights.game_quality +
    timing.score * weights.timing +
    context.score * weights.context
  );

  // Save score
  await supabase.from('scores').upsert({
    game_id: game.id,
    price_score: price.score,
    experience_score: experience.score,
    game_quality_score: gameQuality.score,
    timing_score: timing.score,
    context_score: context.score,
    deal_score: clamp(dealScore, 0, 10),
    reasoning_summary: [price.reasoning, gameQuality.reasoning].filter(r => r && r !== 'No standings data').join(' · '),
    score_breakdown: { price, experience, gameQuality, timing, context },
  }, { onConflict: 'game_id' });

  console.log(`  Deal Score: ${dealScore} (Price: ${price.score} | Exp: ${experience.score} | Quality: ${gameQuality.score} | Timing: ${timing.score} | Weather: ${context.score})`);
}

async function main() {
  console.log('Rescoring games (no AI tokens used)\n');

  // Include games that started up to 4 hours ago (may still be live/scoreable)
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  const { data: games, error } = await supabase
    .from('games')
    .select('*')
    .eq('status', 'scheduled')
    .eq('is_home_game', true)
    .gte('start_time', cutoff)
    .order('start_time', { ascending: true })
    .limit(50);

  if (error || !games) {
    console.error('Failed to fetch games:', error?.message);
    return;
  }

  console.log(`Found ${games.length} games to rescore\n`);

  for (const game of games) {
    console.log(`[${game.league}] ${game.away_team_name} @ ${game.home_team_name}`);
    try {
      await rescoreGame(game);
    } catch (err) {
      console.error(`  ERROR:`, err);
    }
  }

  console.log('\nDone! No tokens were used.');
}

main();
