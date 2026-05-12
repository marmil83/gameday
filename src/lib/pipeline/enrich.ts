// Enrichment Pipeline
// Orchestrates AI enrichment, scoring, and ranking for games

import { createServiceClient } from '../supabase/server';
import { enrichGame } from '../ai/claude';
import { calculateDealScore } from '../scoring/deal-score';
import { getWeatherForGame } from './weather';
import { detectBigGame } from './big-game-detector';
import { LEAGUE_AVG_PRICES, GAMES_PER_CITY, getPriceBaseline } from '../constants';
import { getVenueLogistics as getVenueLogisticsServer } from '../venues';
import type { Game, PricingSnapshot, Promotion } from '@/types/database';

/**
 * Get the best pricing snapshot for a game.
 * Prefers the cheapest non-null price across all sources — never lets a null
 * SeatGeek snapshot (common when games are sold-out or already started) shadow
 * a real price from TickPick or another source.
 */
async function getLatestPricing(gameId: string): Promise<PricingSnapshot | null> {
  const supabase = createServiceClient();

  // First: cheapest snapshot with an actual price
  const { data: priced } = await supabase
    .from('pricing_snapshots')
    .select('*')
    .eq('game_id', gameId)
    .not('lowest_price', 'is', null)
    .order('lowest_price', { ascending: true })
    .limit(1)
    .single();

  if (priced) return priced as PricingSnapshot;

  // Fallback: most recent snapshot (may have null price — scoring handles that)
  const { data: latest } = await supabase
    .from('pricing_snapshots')
    .select('*')
    .eq('game_id', gameId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  return latest as PricingSnapshot | null;
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

  // Get home team info (venue type + standings + recent form)
  const { data: homeTeam } = await supabase
    .from('teams')
    .select('venue_type, wins, losses, win_pct, streak, external_ids')
    .eq('id', game.home_team_id)
    .single();

  const isOutdoor = homeTeam?.venue_type === 'outdoor';

  // Get away team standings (may not exist if team isn't in our DB; the
  // standings fetcher auto-discovers and seeds these in External city)
  const { data: awayTeam } = await supabase
    .from('teams')
    .select('wins, losses, win_pct, streak, external_ids')
    .eq('name', game.away_team_name)
    .single();

  // Pull last_10 from external_ids for both teams (null when not yet captured)
  const homeExt = (homeTeam?.external_ids as { last_10_wins?: number; last_10_losses?: number } | null) || null;
  const awayExt = (awayTeam?.external_ids as { last_10_wins?: number; last_10_losses?: number } | null) || null;
  const homeLast10 = homeExt?.last_10_wins != null && homeExt?.last_10_losses != null
    ? { wins: homeExt.last_10_wins, losses: homeExt.last_10_losses } : null;
  const awayLast10 = awayExt?.last_10_wins != null && awayExt?.last_10_losses != null
    ? { wins: awayExt.last_10_wins, losses: awayExt.last_10_losses } : null;

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

  // Compute base game quality from standings
  const homePct = Number(homeTeam?.win_pct) || 0;
  const awayPct = awayTeam ? (Number(awayTeam.win_pct) || 0) : 0.5;
  const hasStandings = homeTeam?.wins != null && (homeTeam.wins > 0 || homeTeam.losses > 0);
  // Sample-size guard: under 10 total games per team, win pct is too noisy
  // to use as a quality signal — start at neutral and let big-game/opening-day
  // boosts carry the score.
  const homeGames = (homeTeam?.wins || 0) + (homeTeam?.losses || 0);
  const awayGames = awayTeam ? (awayTeam.wins || 0) + (awayTeam.losses || 0) : 10;
  const smallSample = homeGames < 10 || awayGames < 10;
  let teamQuality: number | undefined;
  if (hasStandings && !smallSample) {
    const avgPct = (homePct + awayPct) / 2;
    teamQuality = 5 + (avgPct - 0.5) * 20;
    const pctDiff = Math.abs(homePct - awayPct);
    if (pctDiff < 0.1) teamQuality += 1;
    else if (pctDiff > 0.25) teamQuality -= 0.5;
    const streak = homeTeam?.streak || '';
    const streakNum = parseInt(streak.replace(/\D/g, '')) || 0;
    if (streak.startsWith('W') && streakNum >= 3) teamQuality += 1;
    teamQuality = Math.max(0, Math.min(10, teamQuality));
  } else if (hasStandings && smallSample) {
    // Neutral baseline so opening-day/big-game boosts dominate, not penalty
    teamQuality = 5;
  }

  // Big game detection — ESPN API + rivalry map
  const bigGame = await detectBigGame(
    game.home_team_name,
    game.away_team_name,
    game.league,
    game.start_time,
  );

  // Pre-Claude playoff fallback: if a prior enrichment already detected this as
  // a playoff game (stored in game_insights.context_flags), trust that even when
  // ESPN now returns isPlayoffs: false. Prevents "playoff-caliber" hedging copy.
  const KNOWN_PLAYOFF_ROUNDS = ['first-round', 'conference-semis', 'conference-finals', 'finals'] as const;
  const { data: priorInsights } = await supabase
    .from('game_insights')
    .select('context_flags')
    .eq('game_id', gameId)
    .single();
  const priorFlags: string[] = (priorInsights?.context_flags as string[]) || [];
  const priorSaysPlayoff = priorFlags.includes('playoff') || priorFlags.includes('elimination') || priorFlags.includes('finals');
  const priorSaysElim = priorFlags.includes('elimination') || priorFlags.includes('finals');
  const priorRound = KNOWN_PLAYOFF_ROUNDS.find(r => priorFlags.includes(r)) ?? null;

  // Effective values for the Claude call (combine ESPN with prior-enrichment memory)
  const isPlayoffsForPrompt = bigGame.isPlayoffs || priorSaysPlayoff;
  const isEliminationForPrompt = bigGame.isElimination || bigGame.isFinals || priorSaysElim;
  const playoffRoundForPrompt = bigGame.playoffRound ?? priorRound ?? (isPlayoffsForPrompt ? 'first-round' : null);

  // Real "home opener" detection — only the team's literal first home game
  // of the season counts, not every game in the first few weeks. The date
  // window in detectOpeningDay() gates this check; if the date is in the
  // window AND no earlier home game exists for this team, it's the opener.
  // Different teams have home openers on different days, so date-window-only
  // detection over-flagged (e.g. WNBA Sparks May 17 was getting "opening
  // day" because it fell in the May 1-20 window even though the team's
  // actual home opener was May 16).
  let isHomeOpener = false;
  if (bigGame.isOpeningDay) {
    // Look back ~6 months for any earlier home game of this team.
    const sixMonthsBack = new Date(new Date(game.start_time).getTime() - 180 * 24 * 3600_000).toISOString();
    const { data: earlierHomeGames } = await supabase
      .from('games')
      .select('id')
      .eq('home_team_id', game.home_team_id)
      .eq('is_home_game', true)
      .gte('start_time', sixMonthsBack)
      .lt('start_time', game.start_time)
      .in('status', ['scheduled', 'completed'])
      .limit(1);
    isHomeOpener = !earlierHomeGames || earlierHomeGames.length === 0;
  }

  // Series-state uncertainty check — for playoff games where ESPN gives us
  // a seriesGameNumber ≥ 2, the actual series state (record, elimination
  // status) depends on the OUTCOMES of earlier games in the series. If any
  // earlier game in this matchup is still 'scheduled' (not played yet), we
  // CANNOT assert elimination or specific record state.
  //
  // Example: Pistons-Cavaliers Game 5 on Wednesday is "bracket Game 5",
  // but whether it's elimination depends on Monday's Game 4. If Monday is
  // still scheduled when we enrich Wednesday, Claude must use conditional
  // language ("could become a closeout if...") rather than claiming
  // "Cleveland faces elimination" as fact.
  //
  // When the prior game completes and the next pipeline run re-enriches
  // Wednesday, the uncertainty resolves and Claude can speak with
  // confidence about the (now-known) series state.
  let seriesUncertain = false;
  if (isPlayoffsForPrompt && bigGame.seriesGameNumber && bigGame.seriesGameNumber >= 2 && game.away_team_name && game.away_team_name !== 'TBD') {
    const twoWeeksBack = new Date(new Date(game.start_time).getTime() - 14 * 24 * 3600_000).toISOString();
    // Find scheduled (not yet completed) games between these same two
    // teams in the last 2 weeks — that's the unresolved earlier series game.
    const { data: priorScheduled } = await supabase
      .from('games')
      .select('id, status, start_time')
      .or(`and(home_team_name.eq.${game.home_team_name},away_team_name.eq.${game.away_team_name}),and(home_team_name.eq.${game.away_team_name},away_team_name.eq.${game.home_team_name})`)
      .gte('start_time', twoWeeksBack)
      .lt('start_time', game.start_time)
      .eq('status', 'scheduled')
      .limit(1);
    seriesUncertain = !!(priorScheduled && priorScheduled.length > 0);
  }

  // Apply big game boosts on top of standings-based team quality
  const boostedTeamQuality = teamQuality !== undefined
    ? Math.min(10, teamQuality + bigGame.gameQualityBoost)
    : bigGame.gameQualityBoost > 0 ? Math.min(10, 5 + bigGame.gameQualityBoost) : undefined;

  const boostedWeatherScore = weatherScore !== undefined
    ? Math.min(10, weatherScore + bigGame.contextBoost)
    : bigGame.contextBoost > 0 ? Math.min(10, 5 + bigGame.contextBoost) : undefined;

  // Auto-resolve TBD opponent from ESPN — update DB so it shows correctly
  if (game.away_team_name === 'TBD' && bigGame.detectedOpponent) {
    await supabase
      .from('games')
      .update({ away_team_name: bigGame.detectedOpponent })
      .eq('id', gameId);
    game.away_team_name = bigGame.detectedOpponent;
  }

  // 1. AI Enrichment — pass big game context so copy leads with stakes
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
    avgLeaguePrice: getPriceBaseline(game.league, playoffRoundForPrompt),
    pricingTransparency: pricing?.pricing_transparency || 'unknown',
    promotions: promotions.map(p => ({
      type: p.promo_type || 'unknown',
      item: p.promo_item,
      description: p.promo_description || '',
    })),
    isOutdoor,
    // Live standings — grounded data so Claude doesn't fabricate team form
    homeRecord: homeTeam?.wins != null && homeTeam?.losses != null
      ? `${homeTeam.wins}-${homeTeam.losses}`
      : null,
    awayRecord: awayTeam?.wins != null && awayTeam?.losses != null
      ? `${awayTeam.wins}-${awayTeam.losses}`
      : null,
    homeStreak: homeTeam?.streak ?? null,
    homeLast10: homeLast10 ? `${homeLast10.wins}-${homeLast10.losses}` : null,
    awayLast10: awayLast10 ? `${awayLast10.wins}-${awayLast10.losses}` : null,
    // Venue logistics — only passed when the venue is in our seeded lookup;
    // Claude is instructed to mention only when notable (expensive parking
    // with a clear transit win), not on every game.
    parkingPrice: (() => {
      const v = getVenueLogisticsServer(game.venue);
      return v?.parking?.free ? 0 : (v?.parking?.typical ?? null);
    })(),
    transitNotes: (() => {
      const v = getVenueLogisticsServer(game.venue);
      return (v?.transit?.available && (v.transit.rating === 'excellent' || v.transit.rating === 'good'))
        ? v.transit.notes
        : null;
    })(),
    // Big game fields. When the series state is uncertain (earlier game
    // hasn't been played yet), we suppress elimination/seriesRecord and
    // signal uncertainty to Claude so it uses conditional language.
    bigGameLabel: bigGame.bigGameLabel,
    isElimination: seriesUncertain ? false : isEliminationForPrompt,
    isFinals: bigGame.isFinals,
    isRivalry: bigGame.isRivalry,
    rivalryName: bigGame.rivalryName,
    seriesRecord: seriesUncertain ? null : bigGame.seriesRecord,
    seriesGameNumber: bigGame.seriesGameNumber,
    seriesUncertain,
    isOpeningDay: isHomeOpener,
    isPlayoffs: isPlayoffsForPrompt,
  });

  // 2. Combine ESPN detection with Claude's returned context_flags.
  // ESPN sometimes misses playoff games (future bracket games, recently scheduled matchups).
  // Claude's answer is the authoritative fallback — if it flagged this as a playoff game,
  // we trust it for scoring and flag merging even when ESPN returned isPlayoffs: false.
  const claudeFlags: string[] = enrichment.context_flags || [];
  const isPlayoffsByAnySource = isPlayoffsForPrompt ||
    claudeFlags.includes('playoff') || claudeFlags.includes('elimination') || claudeFlags.includes('finals');
  // When series state is uncertain (earlier game unplayed), we cannot
  // claim elimination — even if ESPN's bracket position or Claude's
  // output suggests it. Same applies to game-7 / series-finale flags
  // that imply a specific resolved series state.
  const isEliminationByAnySource = seriesUncertain
    ? false
    : (isEliminationForPrompt || claudeFlags.includes('elimination') || claudeFlags.includes('finals'));
  // Prefer ESPN round (most specific) → prior round → Claude round → default if any source says playoffs
  const claudeRound = KNOWN_PLAYOFF_ROUNDS.find(r => claudeFlags.includes(r)) ?? null;
  const effectivePlayoffRound = bigGame.playoffRound ?? priorRound ?? claudeRound ?? (isPlayoffsByAnySource ? 'first-round' : null);

  // 3. Calculate Deal Score with boosted inputs
  const scoreResult = calculateDealScore({
    game: game as Game,
    pricing,
    promotions,
    isOutdoor,
    weatherScore: boostedWeatherScore,
    teamQuality: boostedTeamQuality,
    isPlayoffs: isPlayoffsByAnySource,
    isElimination: isEliminationByAnySource,
    isOpeningDay: bigGame.isOpeningDay,
    playoffRound: effectivePlayoffRound,
    isRivalry: bigGame.isRivalry,
    timezone: tz,
    // Recent form + marquee inputs — populated when standings are available
    homeLast10,
    awayLast10,
    homeWinPct: homeTeam?.win_pct != null ? Number(homeTeam.win_pct) : null,
    awayWinPct: awayTeam?.win_pct != null ? Number(awayTeam.win_pct) : null,
  });

  // 4. Merge big game flags into AI context_flags
  // When seriesUncertain, suppress every flag that implies a specific
  // resolved series state: 'elimination' is already false above;
  // 'game-7' would require the prior 6 games to be played (impossible
  // if any earlier game is still scheduled); 'finals' refers to the
  // championship SERIES so it's still valid — but only if ESPN flagged
  // it independently of the unplayed-game inference.
  const bigGameFlags: string[] = [];
  if (isPlayoffsByAnySource) bigGameFlags.push('playoff');
  if (isEliminationByAnySource) bigGameFlags.push('elimination');
  if (bigGame.isFinals) bigGameFlags.push('finals');
  if (!seriesUncertain && bigGame.seriesGameNumber === 7) bigGameFlags.push('game-7');
  if (bigGame.isRivalry) bigGameFlags.push('rivalry');
  if (isHomeOpener) bigGameFlags.push('opening-day');
  // Store the round slug directly (e.g. 'conference-semis', 'conference-finals') so rescore.ts
  // can derive the right price baseline without an extra DB query.
  if (effectivePlayoffRound) bigGameFlags.push(effectivePlayoffRound);

  // Bad-weather warning — outdoor venue with poor forecast. weather_score
  // is 0-10 (10 = perfect, 0 = severe). Threshold ≤3 catches heavy rain,
  // extreme cold/heat, etc. — meaningful information for the visitor's
  // decision (bring poncho? skip? swap dates?).
  if (isOutdoor && weatherScore !== undefined && weatherScore <= 3) {
    bigGameFlags.push('bad-weather');
  }

  // Doubleheader / back-to-back same-day — useful "did you know?" info.
  // Common in MLB; rare elsewhere. Detected by counting other home games
  // for this team on the same local calendar date in the city's timezone.
  const localDateOfStart = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(game.start_time));
  const targetMs = new Date(`${localDateOfStart}T12:00:00Z`).getTime();
  const { data: sameDayGames } = await supabase
    .from('games')
    .select('id, start_time')
    .eq('home_team_id', game.home_team_id)
    .neq('id', gameId)
    .eq('is_home_game', true)
    .gte('start_time', new Date(targetMs - 36 * 3600_000).toISOString())
    .lte('start_time', new Date(targetMs + 36 * 3600_000).toISOString());
  const localFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const isDoubleheader = (sameDayGames || []).some(
    g => localFmt.format(new Date(g.start_time)) === localDateOfStart,
  );
  if (isDoubleheader) bigGameFlags.push('doubleheader');

  // Series finale — final game of a known-length series. Only fires
  // when series state is RESOLVED (seriesUncertain=false) — otherwise
  // we'd label a Game 5 as a finale based on a Game 4 outcome that
  // hasn't happened yet.
  if (!seriesUncertain && bigGame.isElimination && bigGame.seriesGameNumber && bigGame.seriesGameNumber !== 7) {
    bigGameFlags.push('series-finale');
  }
  // Filter Claude's flags — opening-day is reliably detected from the game
  // date (see detectOpeningDay), so we drop Claude's claim when ESPN's
  // window-based check disagrees. Stops Claude from over-applying it to
  // every early-season game.
  const claudeFiltered = (enrichment.context_flags || []).filter(f => {
    if (f === 'opening-day' && !isHomeOpener) return false;
    // Drop series-state-dependent flags when an earlier game is still
    // scheduled. These would put the "Elimination Game" / "Game 7" /
    // "Series Finale" banner on a game whose state isn't yet known.
    if (seriesUncertain && (f === 'elimination' || f === 'game-7' || f === 'series-finale')) return false;
    return true;
  });
  const mergedContextFlags = [...new Set([...claudeFiltered, ...bigGameFlags])];

  // 5. Save score
  await supabase.from('scores').upsert({
    game_id: gameId,
    ...scoreResult,
    score_breakdown: {
      ...(scoreResult.score_breakdown as object),
      bigGame: {
        label: bigGame.bigGameLabel,
        gameQualityBoost: bigGame.gameQualityBoost,
        contextBoost: bigGame.contextBoost,
        isElimination: bigGame.isElimination,
        isRivalry: bigGame.isRivalry,
      },
    },
  }, { onConflict: 'game_id' });

  // 6. Save insights
  await supabase.from('game_insights').upsert({
    game_id: gameId,
    expectation_summary: enrichment.expectation_summary,
    target_audience: enrichment.target_audience,
    effort_level: enrichment.effort_level,
    price_insight: enrichment.price_insight,
    promo_clarity: enrichment.promo_clarity,
    seat_expectation: enrichment.seat_expectation,
    context_flags: mergedContextFlags,
    verdict: enrichment.verdict,
    why_worth_it: enrichment.why_worth_it,
    confidence_score: isPlayoffsByAnySource ? 0.95 : 0.8,
  }, { onConflict: 'game_id' });

  // 7. Save vibe tags — playoffs always get high-energy
  await supabase
    .from('tags')
    .delete()
    .eq('game_id', gameId)
    .eq('source_type', 'ai');

  const vibeTags = [...enrichment.vibe_tags];
  if (isPlayoffsByAnySource && !vibeTags.includes('high-energy')) vibeTags.push('high-energy');

  for (const tag of vibeTags) {
    await supabase.from('tags').upsert({
      game_id: gameId,
      tag_name: tag,
      source_type: 'ai',
      confidence_score: 0.85,
    }, { onConflict: 'game_id,tag_name' });
  }

  // 8. Auto-feature elimination games and finals
  const updates: Record<string, unknown> = { pipeline_status: 'enriched' };
  if (isEliminationByAnySource) updates.is_featured = true;

  await supabase
    .from('games')
    .update(updates)
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
    .limit(50);

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

  // Pull a generous ±36h UTC window around the target date, then filter
  // results to those whose LOCAL date in the city's timezone exactly
  // matches targetDate. This is the same pattern we use for the TickPick
  // scraper and promo matcher — it's the only way to get correct date
  // grouping that's robust to runtime timezone, DST, and games that fall
  // exactly on a midnight boundary in the target TZ.
  //
  // The previous approach computed UTC boundaries via a string-parse-then-
  // re-offset dance that accumulated a ~1ms drift. A game at exactly
  // midnight in the target TZ (common for ESPN's placeholder TBD-time
  // games — e.g. Pistons playoff games) ended up just past dayEnd of the
  // PREVIOUS day, getting wrongly grouped under the wrong calendar day.
  const targetMs = new Date(`${targetDate}T12:00:00Z`).getTime();
  const dayStart = new Date(targetMs - 36 * 3600_000).toISOString();
  const dayEnd = new Date(targetMs + 36 * 3600_000).toISOString();

  const localFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });

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

  // Strict local-date filter: drop any game whose local date in the
  // city's timezone doesn't exactly match targetDate. Catches games at
  // the midnight boundary that the wide UTC window over-fetched.
  const dateMatched = games.filter(g => localFmt.format(new Date(g.start_time)) === targetDate);

  // Sort by deal score (featured games first, then by score)
  const sorted = dateMatched.sort((a, b) => {
    if (a.is_featured && !b.is_featured) return -1;
    if (!a.is_featured && b.is_featured) return 1;
    const scoreA = (Array.isArray(a.scores) ? a.scores[0]?.deal_score : a.scores?.deal_score) || 0;
    const scoreB = (Array.isArray(b.scores) ? b.scores[0]?.deal_score : b.scores?.deal_score) || 0;
    return scoreB - scoreA;
  });

  return sorted.slice(0, limit).map(game => {
    // Get the latest pricing snapshot
    const allSnapshots: PricingSnapshot[] = (game.pricing_snapshots || [])
      .sort((a: { captured_at: string }, b: { captured_at: string }) =>
        new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
      );

    // Deduplicate by source_name — keep the most recent per source
    const seenSources = new Set<string>();
    const dedupedPricing: PricingSnapshot[] = [];
    for (const snap of allSnapshots) {
      if (!seenSources.has(snap.source_name)) {
        seenSources.add(snap.source_name);
        dedupedPricing.push(snap);
      }
    }

    // Headline price = cheapest priced source
    const latestPricing = dedupedPricing
      .filter(s => s.lowest_price != null)
      .sort((a, b) => (a.lowest_price ?? 999) - (b.lowest_price ?? 999))[0] || dedupedPricing[0] || null;

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
      all_pricing: dedupedPricing,
      promotions: game.promotions || [],
      score: Array.isArray(game.scores) ? game.scores[0] || null : game.scores || null,
      tags: Array.isArray(game.tags) ? game.tags : game.tags ? [game.tags] : [],
      insights: Array.isArray(game.game_insights) ? game.game_insights[0] || null : game.game_insights || null,
      home_team_logo: (game as any).home_team?.logo_url || null,
      away_team_logo: (game as any).away_team?.logo_url || null,
    };
  });
}
