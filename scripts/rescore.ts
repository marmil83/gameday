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

const DEAL_SCORE_WEIGHTS = { price: 0.4, experience: 0.2, game_quality: 0.2, timing: 0.1, context: 0.1 };

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
function round(v: number, d = 2) { return Math.round(v * 10 ** d) / 10 ** d; }

function calcPriceScore(league: string, lowestPrice: number | null) {
  if (!lowestPrice) return { score: 5, reasoning: 'No pricing data' };
  const avg = LEAGUE_AVG_PRICES[league] || 40;
  const ratio = lowestPrice / avg;
  let score = ratio <= 0.25 ? 10 : ratio <= 0.5 ? 8 + (0.5 - ratio) * 8 : ratio <= 1 ? 5 + (1 - ratio) * 6 : ratio <= 1.5 ? 3 + (1.5 - ratio) * 4 : ratio <= 2 ? 1 + (2 - ratio) * 4 : 1;
  const reasoning = ratio < 0.7
    ? `Great value at $${lowestPrice} (typical: $${avg})`
    : ratio < 1.1
      ? `Fair price at $${lowestPrice} (typical: $${avg})`
      : `Above average at $${lowestPrice} (typical: $${avg})`;
  return { score: clamp(round(score), 0, 10), reasoning };
}

function calcTimingScore(startTime: string, timezone?: string) {
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
  return { score: clamp(round(score), 0, 10), reasoning: factors.join(', ') || 'Weeknight game' };
}

function calcExperienceScore(promos: any[]) {
  if (!promos || promos.length === 0) return { score: 3, reasoning: 'No promotions detected' };
  let score = 3;
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
    reasoning: highlights.length > 0 ? `Includes: ${highlights.join(', ')}` : 'Standard game experience',
  };
}

function calcGameQuality(
  homeTeam: { wins: number; losses: number; win_pct: number; streak: string | null } | null,
  awayTeam: { wins: number; losses: number; win_pct: number; streak: string | null } | null,
) {
  if (!homeTeam || (!homeTeam.wins && !homeTeam.losses)) {
    return { score: 5, reasoning: 'No standings data' };
  }

  let score = 5;
  const factors: string[] = [];

  const homePct = Number(homeTeam.win_pct) || 0;
  const awayPct = awayTeam ? (Number(awayTeam.win_pct) || 0) : 0.5;

  const avgPct = (homePct + awayPct) / 2;
  const qualityBoost = (avgPct - 0.5) * 5;
  score += qualityBoost;
  if (avgPct >= 0.55) factors.push('both teams competitive');
  if (avgPct < 0.4) factors.push('both teams struggling');

  const pctDiff = Math.abs(homePct - awayPct);
  if (pctDiff < 0.1) { score += 1; factors.push('evenly matched'); }
  else if (pctDiff > 0.25) { score -= 0.5; factors.push('lopsided matchup'); }

  const homeStreak = homeTeam.streak || '';
  const homeStreakNum = parseInt(homeStreak.replace(/\D/g, '')) || 0;
  if (homeStreak.startsWith('W') && homeStreakNum >= 3) { score += 1; factors.push(`home team on ${homeStreak}`); }
  if (homeStreak.startsWith('L') && homeStreakNum >= 5) { score -= 0.5; factors.push(`home team on ${homeStreak}`); }

  if (homePct >= 0.6) { score += 0.5; factors.push('strong home team'); }

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
    .select('venue_type, wins, losses, win_pct, streak')
    .eq('id', game.home_team_id)
    .single();

  const isOutdoor = team?.venue_type === 'outdoor';

  // Get latest pricing
  const { data: pricing } = await supabase
    .from('pricing_snapshots')
    .select('lowest_price')
    .eq('game_id', game.id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  // Get promotions
  const { data: promos } = await supabase.from('promotions').select('promo_type, promo_item').eq('game_id', game.id);

  // Get away team standings
  const { data: awayTeamData } = await supabase
    .from('teams')
    .select('wins, losses, win_pct, streak')
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
  const homeTeamData = team ? { wins: team.wins, losses: team.losses, win_pct: team.win_pct, streak: team.streak } : null;

  // Calculate all sub-scores (pure math, no AI)
  const price = calcPriceScore(game.league, lowestPrice);
  const experience = calcExperienceScore(promos || []);
  const gameQuality = calcGameQuality(homeTeamData, awayTeamData);
  const timing = calcTimingScore(game.start_time, tz);
  const contextScore = isOutdoor && weather ? weather.weather_score : 5;
  const context = { score: contextScore, reasoning: isOutdoor && weather ? (contextScore >= 7 ? 'great weather' : contextScore <= 3 ? 'weather concern' : 'fair weather') : 'Standard conditions' };

  const dealScore = round(
    price.score * DEAL_SCORE_WEIGHTS.price +
    experience.score * DEAL_SCORE_WEIGHTS.experience +
    gameQuality.score * DEAL_SCORE_WEIGHTS.game_quality +
    timing.score * DEAL_SCORE_WEIGHTS.timing +
    context.score * DEAL_SCORE_WEIGHTS.context
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

  const { data: games, error } = await supabase
    .from('games')
    .select('*')
    .eq('status', 'scheduled')
    .eq('is_home_game', true)
    .gte('start_time', new Date().toISOString())
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
