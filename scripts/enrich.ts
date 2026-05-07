// Direct enrichment script — runs outside of HTTP request timeout
// Usage: npx tsx scripts/enrich.ts

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { getWeatherForGame } from '../src/lib/pipeline/weather';
import { detectBigGame, type BigGameContext } from '../src/lib/pipeline/big-game-detector';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

const DEAL_SCORE_WEIGHTS = { price: 0.4, experience: 0.2, game_quality: 0.2, timing: 0.1, context: 0.1 };

function clamp(v: number, min: number, max: number) { return Math.min(max, Math.max(min, v)); }
function round(v: number, d = 2) { return Math.round(v * 10 ** d) / 10 ** d; }

function calcPriceScore(league: string, lowestPrice: number | null, playoffRound?: string | null) {
  if (!lowestPrice) return { score: 5, reasoning: 'No pricing data' };
  const avg = getPriceBaseline(league, playoffRound);
  const ratio = lowestPrice / avg;
  let score = ratio <= 0.25 ? 10 : ratio <= 0.5 ? 8 + (0.5 - ratio) * 8 : ratio <= 1 ? 5 + (1 - ratio) * 6 : ratio <= 1.5 ? 3 + (1.5 - ratio) * 4 : ratio <= 2 ? 1 + (2 - ratio) * 4 : 1;
  const marketLabel = playoffRound ? 'playoff avg' : 'avg';
  return { score: clamp(round(score), 0, 10), reasoning: `$${lowestPrice} vs ${marketLabel} $${avg}` };
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
  if (day === 0 || day === 6) score += 2;
  else if (day === 5) score += 1.5;
  if (hour >= 17 && hour <= 19) score += 1.5;
  else if (hour >= 12 && hour <= 15) score += 1;
  else if (hour >= 20) score -= 0.5;
  // Playoff weeknight boost — people rearrange their schedule for playoffs
  if (isPlayoffs && day >= 1 && day <= 4) score += 1;
  return { score: clamp(round(score), 0, 10) };
}

function calcExperienceScore(promos: any[], isPlayoffs?: boolean, isElimination?: boolean) {
  // Playoff baseline: virtually all home playoff games have rally towels, shirts, or elevated atmosphere.
  // Apply even if no promos were scraped — they're just not listed on the regular promo page.
  const playoffBaseline = isElimination ? 4.0 : isPlayoffs ? 3.0 : 0;

  if (!promos || promos.length === 0) {
    const reasoning = isElimination
      ? 'Playoff atmosphere — expect giveaways and electric crowd'
      : isPlayoffs
        ? 'Playoff atmosphere — elevated energy and likely giveaways'
        : 'No promotions detected';
    return { score: clamp(3 + playoffBaseline, 0, 10), reasoning };
  }

  let score = 3 + playoffBaseline;
  for (const p of promos) {
    switch (p.promo_type) {
      case 'giveaway': score += 3; break;
      case 'fireworks': score += 2.5; break;
      case 'theme_night': score += 2; break;
      case 'family_promo': score += 1.5; break;
      case 'food_bev_promo': score += 1.5; break;
      case 'special_ticket': score += 1; break;
      default: score += 1;
    }
  }
  return { score: clamp(round(score), 0, 10), reasoning: isPlayoffs ? 'Playoff atmosphere + promotions' : undefined };
}

function calcGameQuality(
  homeTeam: { wins: number; losses: number; win_pct: number; streak: string | null } | null,
  awayTeam: { wins: number; losses: number; win_pct: number; streak: string | null } | null,
  league: string,
) {
  // No standings data → neutral baseline
  if (!homeTeam || !homeTeam.wins && !homeTeam.losses) {
    return { score: 5, reasoning: 'No standings data' };
  }

  let score = 5;
  const factors: string[] = [];

  const homePct = Number(homeTeam.win_pct) || 0;
  const awayPct = awayTeam ? (Number(awayTeam.win_pct) || 0) : 0.5;

  // Combined team quality: average of both teams' win %
  // Two great teams = exciting game, two bad teams = less exciting
  const avgPct = (homePct + awayPct) / 2;
  // 0.600+ avg = both competitive → +2, 0.500 = average → 0, 0.400 = both struggling → -1
  const qualityBoost = (avgPct - 0.5) * 5; // ranges from -2.5 to +2.5
  score += qualityBoost;
  if (avgPct >= 0.55) factors.push('both teams competitive');
  if (avgPct < 0.4) factors.push('both teams struggling');

  // Competitive matchup bonus: close win% = more exciting
  const pctDiff = Math.abs(homePct - awayPct);
  if (pctDiff < 0.1) {
    score += 1;
    factors.push('evenly matched');
  } else if (pctDiff > 0.25) {
    score -= 0.5;
    factors.push('lopsided matchup');
  }

  // Hot streak bonus
  const homeStreak = homeTeam.streak || '';
  const homeStreakNum = parseInt(homeStreak.replace(/\D/g, '')) || 0;
  if (homeStreak.startsWith('W') && homeStreakNum >= 3) {
    score += 1;
    factors.push(`home team on ${homeStreak}`);
  }
  if (homeStreak.startsWith('L') && homeStreakNum >= 5) {
    score -= 0.5;
    factors.push(`home team on ${homeStreak}`);
  }

  // Home team having a great season
  if (homePct >= 0.6) {
    score += 0.5;
    factors.push('strong home team');
  }

  const homeRec = homeTeam.wins && homeTeam.losses ? `${homeTeam.wins}-${homeTeam.losses}` : null;
  const awayRec = awayTeam?.wins && awayTeam?.losses ? `${awayTeam.wins}-${awayTeam.losses}` : null;
  const reasoning = [
    homeRec ? `Home: ${homeRec}` : null,
    awayRec ? `Away: ${awayRec}` : null,
    ...factors,
  ].filter(Boolean).join(', ');

  return { score: clamp(round(score), 0, 10), reasoning };
}

async function enrichGame(game: any) {
  const startTime = new Date(game.start_time);

  // Get city timezone for accurate local time formatting
  const { data: city } = await supabase.from('cities').select('timezone').eq('id', game.city_id).single();
  const tz = city?.timezone || 'America/New_York';

  // Get team venue type and standings
  const { data: team } = await supabase.from('teams').select('venue_type, wins, losses, win_pct, streak').eq('id', game.home_team_id).single();
  const isOutdoor = team?.venue_type === 'outdoor';

  // Get best pricing: cheapest non-null price across all sources.
  // A null SeatGeek snapshot must never shadow a real TickPick price.
  let { data: pricing } = await supabase
    .from('pricing_snapshots')
    .select('*')
    .eq('game_id', game.id)
    .not('lowest_price', 'is', null)
    .order('lowest_price', { ascending: true })
    .limit(1)
    .single();
  if (!pricing) {
    const { data: fallback } = await supabase
      .from('pricing_snapshots')
      .select('*')
      .eq('game_id', game.id)
      .order('captured_at', { ascending: false })
      .limit(1)
      .single();
    pricing = fallback;
  }

  // Get promotions
  const { data: promos } = await supabase.from('promotions').select('*').eq('game_id', game.id);

  const lowestPrice = pricing?.lowest_price || null;

  // ── Big game detection ──────────────────────────────────────
  console.log(`  Detecting big game context...`);
  const bigGame = await detectBigGame(game.home_team_name, game.away_team_name, game.league, game.start_time);
  // Playoff-aware price baseline — used for both scoring and AI copy
  // Default to 'first-round' when playoff detected but round unknown (ESPN API miss)
  const effectiveRoundForBaseline = bigGame.playoffRound ?? (bigGame.isPlayoffs ? 'first-round' : null);
  const avgPrice = getPriceBaseline(game.league, effectiveRoundForBaseline);
  if (bigGame.bigGameLabel) {
    console.log(`  🏆 Big game: ${bigGame.bigGameLabel} (+${bigGame.gameQualityBoost} GQ, +${bigGame.contextBoost} CTX)`);
  }
  if (bigGame.isRivalry) {
    console.log(`  ⚡ Rivalry: ${bigGame.rivalryName}`);
  }

  // Build context section for AI prompt
  const bigGameSection = bigGame.bigGameLabel || bigGame.isRivalry || bigGame.isOpeningDay
    ? `\nGame Context (HIGH PRIORITY — reflect this in your copy):
${bigGame.bigGameLabel ? `- THIS IS: ${bigGame.bigGameLabel}` : ''}
${bigGame.isElimination ? '- ELIMINATION GAME: Lose and you go home. Max stakes.' : ''}
${bigGame.isFinals ? '- CHAMPIONSHIP SERIES: The biggest stage in the sport.' : ''}
${bigGame.isRivalry && bigGame.rivalryName ? `- RIVALRY GAME: ${bigGame.rivalryName} — historic bad blood, crowd will be electric.` : ''}
${bigGame.seriesRecord ? `- Series status: ${bigGame.seriesRecord}` : ''}
${bigGame.isOpeningDay ? '- OPENING DAY: First game of the season — always special.' : ''}`.trim()
    : '';

  // Fetch away team record for grounding (before Claude call)
  const { data: awayTeamForPrompt } = await supabase
    .from('teams')
    .select('wins, losses, streak')
    .eq('name', game.away_team_name)
    .single();
  const awayTeamRecord = awayTeamForPrompt?.wins != null
    ? `${awayTeamForPrompt.wins}-${awayTeamForPrompt.losses}${awayTeamForPrompt.streak ? ` (${awayTeamForPrompt.streak})` : ''}`
    : 'unknown';

  // Call Claude for enrichment
  console.log(`  AI enriching...`);
  const promoText = (promos && promos.length > 0)
    ? promos.map((p: any) => `- ${p.promo_type}: ${p.promo_description}`).join('\n')
    : 'No promotions detected.';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are a sports recommendation engine. Generate enrichment data for a game listing.

Game Details:
- ${game.home_team_name} vs ${game.away_team_name}
- League: ${game.league}
- Venue: ${game.venue} (${isOutdoor ? 'outdoor' : 'indoor'})
- Start: ${startTime.toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
- Lowest ticket price: ${lowestPrice ? `$${lowestPrice}` : 'Unknown'}
- Typical ${game.league} ticket: $${avgPrice}
- ${game.home_team_name} record: ${team?.wins != null ? `${team.wins}-${team.losses}` : 'unknown'}${team?.streak ? ` (${team.streak})` : ''}
- ${game.away_team_name} record: ${awayTeamRecord}
${bigGameSection}

Promotions:
${promoText}

Generate the following as a JSON object:

1. "why_worth_it": One sentence explaining why this game is worth attending. If it's a big game (playoff, rivalry, elimination), lead with THAT.
2. "verdict": One highly opinionated sentence about whether to go. Feel confident and human. For big games, be emphatic.
3. "expectation_summary": Short description of what the atmosphere will feel like. Big games = electric, loud, historic.
4. "target_audience": Array of 1-3 from: "families", "date night", "casual fans", "hardcore fans", "cheap night out", "social outing"
5. "effort_level": One of: "easy", "moderate", "high_effort"
6. "price_insight": Short insight about pricing. Note if demand may spike for big games.
7. "seat_expectation": What the displayed price likely gets you.
8. "context_flags": Array of relevant string flags. Include "playoff", "elimination", "rivalry", "game-7", "finals", "opening-day" as applicable.
9. "vibe_tags": Array of 1-3 from: "family-friendly", "high-energy", "cheap-night", "date-night", "chill", "promo-driven"
10. "promo_clarity": Practical promo guidance, or null if no promos.

IMPORTANT: Team records and streaks are provided above — use ONLY those values. Do NOT draw on any external or training knowledge about team performance or recent results. If price is unknown, say so. Return ONLY valid JSON.`
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  let enrichment;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    enrichment = JSON.parse(match![0]);
  } catch {
    console.log('  Failed to parse AI response, using defaults');
    enrichment = {
      why_worth_it: 'A solid option for catching a live game.',
      verdict: 'Worth considering if you\'re looking for something to do.',
      expectation_summary: 'Standard game atmosphere.',
      target_audience: ['casual fans'],
      effort_level: 'moderate',
      price_insight: 'Pricing data unavailable.',
      seat_expectation: 'Depends on availability.',
      context_flags: [],
      vibe_tags: ['chill'],
      promo_clarity: null,
    };
  }

  // Fetch weather for outdoor venues
  let weather = null;
  if (isOutdoor) {
    console.log(`  Fetching weather for ${game.venue}...`);
    weather = await getWeatherForGame(game.venue, game.start_time);
    if (weather) {
      console.log(`  Weather: ${weather.icon} ${weather.temp_f}°F ${weather.condition} (score: ${weather.weather_score})`);
    }
  }

  // Fetch standings for both teams to compute game quality
  const { data: homeTeamData } = await supabase
    .from('teams')
    .select('wins, losses, win_pct, streak')
    .eq('id', game.home_team_id)
    .single();

  const { data: awayTeamData } = await supabase
    .from('teams')
    .select('wins, losses, win_pct, streak')
    .eq('name', game.away_team_name)
    .single();

  const baseGameQuality = calcGameQuality(homeTeamData, awayTeamData, game.league);

  // Calculate Deal Score — apply big game boosts on top of base scores
  // Combine ESPN detection + Claude's context_flags as source of truth for playoff status.
  // ESPN API may miss games (future dates, schedule not yet indexed), so Claude's judgment acts as fallback.
  const claudeFlags: string[] = enrichment.context_flags || [];
  const isPlayoffsByAnySource = bigGame.isPlayoffs ||
    claudeFlags.includes('playoff') || claudeFlags.includes('elimination') || claudeFlags.includes('finals');
  const isEliminationByAnySource = bigGame.isElimination || bigGame.isFinals ||
    claudeFlags.includes('elimination') || claudeFlags.includes('finals');
  const KNOWN_ROUNDS = ['first-round', 'conference-semis', 'conference-finals', 'finals'] as const;
  const claudeRound = KNOWN_ROUNDS.find(r => claudeFlags.includes(r)) ?? null;
  const effectivePlayoffRound = bigGame.playoffRound ?? claudeRound ?? (isPlayoffsByAnySource ? 'first-round' : null);

  const price = calcPriceScore(game.league, lowestPrice, effectivePlayoffRound);
  const experience = calcExperienceScore(promos || [], isPlayoffsByAnySource, isEliminationByAnySource);
  const timing = calcTimingScore(game.start_time, tz, isPlayoffsByAnySource);

  // Game quality: standings-based baseline + big game boost
  const gameQualityScore = clamp(baseGameQuality.score + bigGame.gameQualityBoost, 0, 10);
  const gameQuality = {
    score: gameQualityScore,
    reasoning: [
      baseGameQuality.reasoning,
      bigGame.bigGameLabel,
      bigGame.isRivalry ? bigGame.rivalryName : null,
    ].filter(Boolean).join(' · '),
  };

  // Context score: weather (outdoor) + big game boost
  const baseContextScore = isOutdoor && weather ? weather.weather_score : 5;
  const contextScore = clamp(baseContextScore + bigGame.contextBoost, 0, 10);
  const context = { score: contextScore };

  const dealScore = round(
    price.score * DEAL_SCORE_WEIGHTS.price +
    experience.score * DEAL_SCORE_WEIGHTS.experience +
    gameQuality.score * DEAL_SCORE_WEIGHTS.game_quality +
    timing.score * DEAL_SCORE_WEIGHTS.timing +
    context.score * DEAL_SCORE_WEIGHTS.context
  );

  // Merge big game flags into AI-generated context_flags
  const bigGameFlags: string[] = [];
  if (bigGame.isPlayoffs) bigGameFlags.push('playoff');
  if (bigGame.isElimination) bigGameFlags.push('elimination');
  if (bigGame.isFinals) bigGameFlags.push('finals');
  if (bigGame.seriesGameNumber === 7) bigGameFlags.push('game-7');
  if (bigGame.isRivalry) bigGameFlags.push('rivalry');
  if (bigGame.isOpeningDay) bigGameFlags.push('opening-day');
  // Store round slug directly so rescore.ts can derive price baseline from context_flags
  if (bigGame.playoffRound) bigGameFlags.push(bigGame.playoffRound);
  const mergedContextFlags = [...new Set([...(enrichment.context_flags || []), ...bigGameFlags])];

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
    score_breakdown: { price, experience, gameQuality, timing, context, bigGame },
  }, { onConflict: 'game_id' });

  // Save insights (including weather and big game context)
  await supabase.from('game_insights').upsert({
    game_id: game.id,
    expectation_summary: enrichment.expectation_summary,
    target_audience: enrichment.target_audience,
    effort_level: enrichment.effort_level,
    price_insight: enrichment.price_insight,
    promo_clarity: enrichment.promo_clarity,
    seat_expectation: enrichment.seat_expectation,
    context_flags: mergedContextFlags,
    verdict: enrichment.verdict,
    why_worth_it: enrichment.why_worth_it,
    confidence_score: bigGame.isPlayoffs ? 0.95 : 0.8,
    weather_temp_f: weather?.temp_f ?? null,
    weather_condition: weather?.condition ?? null,
    weather_icon: weather?.icon ?? null,
    weather_score: weather?.weather_score ?? null,
  }, { onConflict: 'game_id' });

  // Save tags (vibe + big game)
  await supabase.from('tags').delete().eq('game_id', game.id).eq('source_type', 'ai');
  const vibeTags: string[] = enrichment.vibe_tags || [];
  // Big games always get 'high-energy' tag; Game 7 / elimination bump to featured
  if (bigGame.isPlayoffs && !vibeTags.includes('high-energy')) vibeTags.push('high-energy');
  for (const tag of vibeTags) {
    await supabase.from('tags').upsert({
      game_id: game.id,
      tag_name: tag,
      source_type: 'ai',
      confidence_score: 0.85,
    }, { onConflict: 'game_id,tag_name' });
  }

  // Auto-feature elimination games and finals
  if (bigGame.isElimination || bigGame.isFinals) {
    await supabase.from('games').update({ is_featured: true }).eq('id', game.id);
    console.log(`  ⭐ Auto-featured (elimination/finals)`);
  }

  // Mark enriched
  await supabase.from('games').update({ pipeline_status: 'enriched' }).eq('id', game.id);

  console.log(`  Deal Score: ${clamp(dealScore, 0, 10)} | Verdict: ${enrichment.verdict?.slice(0, 60)}...`);
  if (bigGame.bigGameLabel) console.log(`  Label: "${bigGame.bigGameLabel}"`);
}

async function main() {
  const force = process.argv.includes('--force');

  // Get games to enrich
  let query = supabase
    .from('games')
    .select('*')
    .eq('status', 'scheduled')
    .eq('is_home_game', true)
    .gte('start_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(20);

  if (!force) {
    query = query.eq('pipeline_status', 'pending');
  }

  const { data: games, error } = await query;

  if (error || !games) {
    console.error('Failed to fetch games:', error?.message);
    return;
  }

  console.log(`Found ${games.length} games to enrich\n`);

  for (const game of games) {
    console.log(`[${game.league}] ${game.away_team_name} @ ${game.home_team_name}`);
    try {
      await enrichGame(game);
    } catch (err) {
      console.error(`  ERROR:`, err);
    }
    console.log('');
  }

  console.log('Done!');
}

main();
