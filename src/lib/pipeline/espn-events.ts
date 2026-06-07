/**
 * ESPN-based event ingestion for major leagues.
 *
 * ESPN is the authoritative source for game schedules, opponents, and times.
 * SeatGeek is used ONLY for pricing and ticket affiliate links.
 *
 * Minor leagues (MiLB, AHL, USL, WHL) are not on ESPN — those stay in events.ts.
 */

import { createServiceClient } from '../supabase/server';
import type { Team } from '@/types/database';

// ─────────────────────────────────────────────
// League routing (mirrors big-game-detector.ts)
// ─────────────────────────────────────────────

const LEAGUE_TO_ESPN: Record<string, { sport: string; league: string }> = {
  NBA:  { sport: 'basketball', league: 'nba' },
  WNBA: { sport: 'basketball', league: 'wnba' },
  NHL:  { sport: 'hockey',     league: 'nhl' },
  MLB:  { sport: 'baseball',   league: 'mlb' },
  NFL:  { sport: 'football',   league: 'nfl' },
  MLS:  { sport: 'soccer',     league: 'usa.1' },
  NWSL: { sport: 'soccer',     league: 'usa.nwsl' },
};

const SEATGEEK_BASE = 'https://api.seatgeek.com/2';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function lastWord(s: string): string {
  return s.trim().split(/\s+/).pop()?.toLowerCase() ?? s.toLowerCase();
}

// Generic suffixes common in soccer — too short or ambiguous to match on alone
const GENERIC_WORDS = new Set(['fc', 'sc', 'cf', 'us', 'usa', 'united', 'city', 'afc', 'sd', 'ny']);

/**
 * Match our DB team name against ESPN's displayName.
 * Handles several cases:
 *   - Exact:     "Detroit Pistons"   vs "Detroit Pistons"   ✓
 *   - Last word: "LA Clippers"       vs "Los Angeles Clippers" (via "Clippers") ✓
 *   - All-sig:   "Portland Thorns FC" vs home team  (ALL sig words must appear) ✓
 *   - Short:     "LAFC"              vs "LAFC"              ✓
 * Prevents false soccer matches like "Portland Thorns FC" vs "Racing Louisville FC"
 * (both end in "FC" — the naive last-word approach fails there).
 */
function teamMatchesESPN(ourName: string, espnDisplayName: string): boolean {
  const e = espnDisplayName.toLowerCase();
  const o = ourName.toLowerCase();

  if (e === o) return true;

  // Short names / abbreviations: LAFC, NYCFC, etc.
  if (o.length <= 6 && e.includes(o)) return true;

  // Last-word match — works for Pistons, Tigers, Timbers, Blazers, Clippers, etc.
  // Skip if the last word is a generic soccer suffix.
  const oLast = lastWord(o);
  if (!GENERIC_WORDS.has(oLast) && oLast.length >= 4) {
    if (lastWord(e) === oLast) return true;
    if (oLast.length >= 5 && e.includes(oLast)) return true;
  }

  // Significant-word overlap: ALL words ≥ 5 chars (not generic) in our name
  // must appear in ESPN's name. Prevents "Portland Thorns FC" from matching
  // "Racing Louisville FC" (they share only "fc", which is filtered out).
  const sigWords = o.split(/\s+/).filter(w => w.length >= 5 && !GENERIC_WORDS.has(w));
  if (sigWords.length > 0) {
    return sigWords.every(w => e.includes(w));
  }

  return false;
}

function formatDateForESPN(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// ─────────────────────────────────────────────
// ESPN scoreboard fetch
//
// IMPORTANT: ESPN's scoreboard endpoint resolves playoff bracket
// matchups inconsistently. A SINGLE-DATE query (?dates=20260519)
// returns "Cleveland Cavaliers @ New York Knicks", but the equivalent
// DATE-RANGE query (?dates=20260517-20260522) returns the same date
// as "TBD @ TBD" because the bracket lookup only happens per-day.
// Result: playoff home games for newer-bracket-position teams (Knicks
// in 2026 playoffs) silently failed to ingest with the range query.
//
// Fix: fan out to one fetch per day in the window, in parallel.
// ESPN is free + has no rate limit issues at this volume (one league
// × 5 days = 5 parallel calls per league per city, ~25 calls per city
// per pipeline run × 4 cities = ~100 calls). All fire concurrently
// so wall-clock time stays near the single-range case.
// ─────────────────────────────────────────────

async function fetchESPNScoreboardSingleDay(
  sport: string,
  espnLeague: string,
  date: Date,
): Promise<unknown[]> {
  const d = formatDateForESPN(date);
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${espnLeague}/scoreboard?dates=${d}&limit=200`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.events as unknown[]) || [];
  } catch {
    return [];
  }
}

async function fetchESPNScoreboard(
  sport: string,
  espnLeague: string,
  startDate: Date,
  endDate: Date,
): Promise<any[]> {
  // Fan out per-day to dodge the date-range bracket-resolution bug.
  const days: Date[] = [];
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  while (cursor <= endDate) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const perDay = await Promise.all(
    days.map(d => fetchESPNScoreboardSingleDay(sport, espnLeague, d)),
  );

  // Deduplicate by ESPN event id — a game scheduled near midnight UTC
  // can appear in two adjacent day queries.
  const seen = new Set<string>();
  const events: unknown[] = [];
  for (const dayEvents of perDay) {
    for (const e of dayEvents) {
      const id = (e as { id?: string })?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      events.push(e);
    }
  }
  return events as any[];
}

// ─────────────────────────────────────────────
// Core migration / upsert logic
// ─────────────────────────────────────────────

/**
 * Insert or update a single ESPN game record, migrating any existing SeatGeek
 * row for the same game in-place (preserving its UUID and all linked data).
 *
 * Priority:
 *   1. ESPN row already exists → refresh game info fields only
 *   2. SeatGeek row exists for same team + date → migrate it to ESPN in-place
 *   3. No existing row → fresh insert
 */
/**
 * After an ESPN row is confirmed, find any SeatGeek rows for the same home team
 * within ±12h and remove them — transferring their pricing to the ESPN row first.
 * Prevents the race condition where SeatGeek ingestion runs after ESPN and creates
 * a duplicate row that then never gets cleaned up.
 */
async function purgeOrphanedSeatGeekRows(
  supabase: ReturnType<typeof createServiceClient>,
  espnGameId: string,
  homeTeamId: string,
  startTime: string,
): Promise<void> {
  const windowStart = new Date(new Date(startTime).getTime() - 12 * 3_600_000).toISOString();
  const windowEnd   = new Date(new Date(startTime).getTime() + 12 * 3_600_000).toISOString();

  const { data: orphans } = await supabase
    .from('games')
    .select('id')
    .eq('home_team_id', homeTeamId)
    .eq('source', 'seatgeek')
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd);

  for (const orphan of orphans ?? []) {
    if (orphan.id === espnGameId) continue; // shouldn't happen, but be safe
    // Transfer pricing snapshots to the ESPN row
    await supabase.from('pricing_snapshots').update({ game_id: espnGameId }).eq('game_id', orphan.id);
    // Delete all other linked data, then the game itself
    await supabase.from('scores').delete().eq('game_id', orphan.id);
    await supabase.from('game_insights').delete().eq('game_id', orphan.id);
    await supabase.from('tags').delete().eq('game_id', orphan.id);
    await supabase.from('promotions').delete().eq('game_id', orphan.id);
    await supabase.from('games').delete().eq('id', orphan.id);
  }
}

async function migrateOrUpsertESPNGame(
  supabase: ReturnType<typeof createServiceClient>,
  espnEventId: string,
  gameData: {
    home_team_id: string;
    away_team_id: string;
    home_team_name: string;
    away_team_name: string;
    league: string;
    venue: string;
    city_id: string;
    start_time: string;  // ISO UTC from ESPN
  },
): Promise<{ gameId: string; action: 'inserted' | 'updated' | 'migrated' }> {
  // 1. Idempotent: ESPN record already exists from a prior run
  const { data: existing } = await supabase
    .from('games')
    .select('id')
    .eq('source_event_id', espnEventId)
    .eq('source', 'espn')
    .maybeSingle();

  if (existing) {
    // Refresh the mutable fields — opponent may have become known, time confirmed
    await supabase.from('games').update({
      away_team_name: gameData.away_team_name,
      start_time: gameData.start_time,
      venue: gameData.venue,
    }).eq('id', existing.id);

    // Sweep for SeatGeek orphans that may have been inserted after this ESPN row
    // was created (SeatGeek runs after ESPN in the pipeline, so this race is common).
    await purgeOrphanedSeatGeekRows(supabase, existing.id, gameData.home_team_id, gameData.start_time);

    return { gameId: existing.id, action: 'updated' };
  }

  // 2. Find an existing SeatGeek (or other) record for the same real-world game.
  //    Use ±12h window — safe because no team plays two home games in 24 hours
  //    and handles timezone edge cases (10 PM ET = 02:00 UTC next day).
  const windowStart = new Date(new Date(gameData.start_time).getTime() - 12 * 3_600_000).toISOString();
  const windowEnd   = new Date(new Date(gameData.start_time).getTime() + 12 * 3_600_000).toISOString();

  const { data: sgRows } = await supabase
    .from('games')
    .select('id, affiliate_url')
    .eq('home_team_id', gameData.home_team_id)
    .neq('source', 'espn')          // not already migrated
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd)
    .limit(1);

  const sgGame = sgRows?.[0] ?? null;

  if (sgGame) {
    // In-place migration: reuse the existing UUID so all foreign-key-linked
    // records (scores, game_insights, tags, pricing_snapshots, promotions) stay intact.
    await supabase.from('games').update({
      source:           'espn',
      source_event_id:  espnEventId,
      home_team_name:   gameData.home_team_name,
      away_team_name:   gameData.away_team_name,
      start_time:       gameData.start_time,
      venue:            gameData.venue,
      // affiliate_url intentionally kept — SeatGeek pricing pass overwrites it shortly
    }).eq('id', sgGame.id);
    return { gameId: sgGame.id, action: 'migrated' };
  }

  // 3. No existing record — fresh insert
  const { data: inserted, error } = await supabase
    .from('games')
    .insert({
      ...gameData,
      source:           'espn',
      source_event_id:  espnEventId,
      status:           'scheduled',
      is_home_game:     true,
      affiliate_url:    null,
    })
    .select('id')
    .single();

  if (error || !inserted) throw new Error(`Insert failed: ${error?.message}`);
  return { gameId: inserted.id, action: 'inserted' };
}

// ─────────────────────────────────────────────
// Main ESPN ingestion
// ─────────────────────────────────────────────

/**
 * Ingest major-league home games from ESPN for a city.
 * One scoreboard API call per league (not per team) — efficient and no API key needed.
 */
export async function ingestESPNEventsForCity(
  cityId: string,
  daysAhead = 14,
): Promise<{ found: number; inserted: number; updated: number; migrated: number; errors: string[] }> {
  const supabase = createServiceClient();

  const { data: teams } = await supabase
    .from('teams')
    .select('*')
    .eq('city_id', cityId)
    .eq('league_level', 'major');

  if (!teams || teams.length === 0) {
    return { found: 0, inserted: 0, updated: 0, migrated: 0, errors: [] };
  }

  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + daysAhead);

  // Group teams by league — one ESPN scoreboard call per league, not per team
  const leagueMap = new Map<string, Team[]>();
  for (const team of teams as Team[]) {
    if (!LEAGUE_TO_ESPN[team.league]) continue; // minor league — handled by events.ts
    if (!leagueMap.has(team.league)) leagueMap.set(team.league, []);
    leagueMap.get(team.league)!.push(team);
  }

  let found = 0, inserted = 0, updated = 0, migrated = 0;
  const errors: string[] = [];

  // Track every ESPN event id we see this run, per league. Used after
  // the ingest loop to purge phantom games — games that USED to be on
  // ESPN's schedule (e.g. NBA "if necessary" playoff Games 6/7) but
  // were dropped when the series ended. Without this, Knicks vs Cavs
  // Game 6/7 stayed in DB as "scheduled" even after the Knicks swept
  // and the games were never played.
  const seenEventIdsByLeague = new Map<string, Set<string>>();

  for (const [league, leagueTeams] of leagueMap) {
    const { sport, league: espnLeague } = LEAGUE_TO_ESPN[league];
    const events = await fetchESPNScoreboard(sport, espnLeague, now, end);
    const seenIds = new Set<string>();
    seenEventIdsByLeague.set(league, seenIds);

    for (const event of events) {
      // Track even before the team-match filter — we want to know
      // "did ESPN return this event id at all?" not "did it match
      // one of our teams?"
      if (event.id) seenIds.add(String(event.id));
      const comp = event.competitions?.[0];
      if (!comp) continue;

      const homeComp = (comp.competitors ?? []).find((c: any) => c.homeAway === 'home');
      const awayComp = (comp.competitors ?? []).find((c: any) => c.homeAway === 'away');
      if (!homeComp) continue;

      const espnHomeName: string = homeComp.team?.displayName ?? '';
      const espnAwayName: string = awayComp?.team?.displayName ?? 'TBD';

      // Find the matching team in our DB
      const matchedTeam = (leagueTeams as Team[]).find(t => teamMatchesESPN(t.name, espnHomeName));
      if (!matchedTeam) continue;

      // Defensive sanity check: matched team's city_id must equal the cityId we're
      // ingesting for. Catches bad seed data (e.g. an away team mistakenly seeded
      // into an MVP city) and prevents ingesting that team's home games as if they
      // belonged to this market.
      if (matchedTeam.city_id !== cityId) {
        errors.push(`Skipped ${espnHomeName}: team city_id ${matchedTeam.city_id} doesn't match ingest cityId ${cityId}. Move team to External city.`);
        continue;
      }

      found++;

      try {
        const { action } = await migrateOrUpsertESPNGame(supabase, String(event.id), {
          home_team_id:    matchedTeam.id,
          away_team_id:    matchedTeam.id,
          home_team_name:  espnHomeName,
          away_team_name:  espnAwayName,
          league:          matchedTeam.league,
          venue:           comp.venue?.fullName ?? matchedTeam.venue_name ?? '',
          city_id:         cityId,
          start_time:      event.date,  // ISO UTC from ESPN
        });

        if (action === 'inserted') inserted++;
        else if (action === 'updated') updated++;
        else migrated++;
      } catch (err) {
        errors.push(`ESPN event ${event.id} (${espnHomeName}): ${err}`);
      }
    }
  }

  // Phantom purge — for each league we ingested, find scheduled ESPN
  // games in our DB whose source_event_id did NOT appear in this run's
  // ESPN response. Mark them cancelled. Without this step, NBA/NHL
  // "if-necessary" Games 6/7 of a series that ended in fewer games
  // (e.g. a sweep) would stay in DB as fake upcoming games forever.
  //
  // Scoped to: source='espn', city + league we just ingested, status
  // 'scheduled' (don't touch completed games), start_time inside the
  // current ingest window. The league filter prevents wiping a sport
  // that wasn't ingested this run (e.g. WNBA pipeline run shouldn't
  // touch NBA rows).
  let purged = 0;
  for (const [league, seenIds] of seenEventIdsByLeague) {
    const { data: dbGames } = await supabase
      .from('games')
      .select('id, source_event_id, away_team_name, home_team_name, start_time')
      .eq('source', 'espn')
      .eq('city_id', cityId)
      .eq('league', league)
      .eq('status', 'scheduled')
      .gte('start_time', now.toISOString())
      .lte('start_time', end.toISOString())
      .not('source_event_id', 'is', null);

    for (const g of dbGames || []) {
      if (g.source_event_id && seenIds.has(String(g.source_event_id))) continue;
      console.log(`[ESPN purge] ${league} ${g.away_team_name} @ ${g.home_team_name} ${g.start_time} — dropped from ESPN, marking cancelled`);
      const { error } = await supabase.from('games').update({ status: 'cancelled' }).eq('id', g.id);
      if (error) errors.push(`Purge ${g.id}: ${error.message}`);
      else purged++;
    }
  }
  if (purged > 0) console.log(`[ESPN purge] ${purged} phantom game(s) marked cancelled`);

  return { found, inserted, updated, migrated, errors };
}

// ─────────────────────────────────────────────
// SeatGeek pricing attachment for ESPN games
// ─────────────────────────────────────────────

interface SGEvent {
  id: number;
  datetime_utc: string;
  datetime_local: string;
  performers: { name: string; home_team?: boolean }[];
  stats: {
    lowest_price: number | null;
    average_price: number | null;
    median_price: number | null;
    listing_count: number | null;
  };
  url: string;
}

async function fetchSeatGeekEventsForTeam(teamSlug: string, daysAhead: number): Promise<SGEvent[]> {
  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) return [];

  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + daysAhead);

  const params = new URLSearchParams({
    'performers.slug': teamSlug,
    'datetime_utc.gte': now.toISOString(),
    'datetime_utc.lte': future.toISOString(),
    client_id: clientId,
    per_page: '50',
  });

  try {
    const res = await fetch(`${SEATGEEK_BASE}/events?${params}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.events || [];
  } catch {
    return [];
  }
}

/**
 * Match SeatGeek events to ESPN game rows for a city's major-league teams.
 * Writes pricing snapshots and affiliate URLs without touching game info.
 */
export async function attachSeatGeekPricingForCity(
  cityId: string,
  daysAhead = 14,
): Promise<{ matched: number; skipped: number }> {
  const supabase = createServiceClient();

  const { data: teams } = await supabase
    .from('teams')
    .select('*')
    .eq('city_id', cityId)
    .eq('league_level', 'major');

  let totalMatched = 0;
  let totalSkipped = 0;

  for (const team of (teams ?? []) as Team[]) {
    if (!team.seatgeek_slug) continue;

    const sgEvents = await fetchSeatGeekEventsForTeam(team.seatgeek_slug, daysAhead);

    // Track used SeatGeek IDs to prevent a doubleheader from matching the same SG event twice
    const usedSGIds = new Set<number>();

    for (const event of sgEvents) {
      // ── Phantom guard (same logic as events.ts) ──────────────
      const homePerformer = event.performers.find(p => p.home_team === true);
      const awayPerformer = event.performers.find(p => p.home_team !== true);
      const rawAwayName   = awayPerformer?.name ?? '';
      const homeName      = homePerformer?.name ?? team.name;
      const isTbdAway     = !rawAwayName || rawAwayName === homeName ||
        /^(nba|nhl|mlb|nfl|mls|ahl|whl|wnba|nwsl|usl|milb)/i.test(rawAwayName);

      if (isTbdAway) {
        const localHour = parseInt(event.datetime_local.split('T')[1]?.split(':')[0] ?? '12');
        if (localHour < 10) { totalSkipped++; continue; } // phantom placeholder
      }
      // ─────────────────────────────────────────────────────────

      if (usedSGIds.has(event.id)) { totalSkipped++; continue; }

      // Match to an ESPN game row by home_team_id + ±12h window
      const windowStart = new Date(new Date(event.datetime_utc).getTime() - 12 * 3_600_000).toISOString();
      const windowEnd   = new Date(new Date(event.datetime_utc).getTime() + 12 * 3_600_000).toISOString();

      const { data: game } = await supabase
        .from('games')
        .select('id, affiliate_url')
        .eq('home_team_id', team.id)
        .eq('source', 'espn')
        .gte('start_time', windowStart)
        .lte('start_time', windowEnd)
        .maybeSingle();

      if (!game) { totalSkipped++; continue; }

      usedSGIds.add(event.id);

      // Always persist the affiliate URL so users have a ticket link.
      if (!game.affiliate_url || game.affiliate_url.includes('seatgeek.com')) {
        await supabase.from('games')
          .update({ affiliate_url: event.url })
          .eq('id', game.id);
      }

      // Only write a pricing snapshot when SeatGeek actually has a price.
      // Null snapshots (sold-out, not-yet-listed, or already-started events) must
      // never shadow a real TickPick price captured earlier — skip them entirely.
      const sgPrice = event.stats?.lowest_price ?? null;
      if (sgPrice !== null) {
        await supabase.from('pricing_snapshots')
          .delete()
          .eq('game_id', game.id)
          .eq('source_name', 'seatgeek');

        await supabase.from('pricing_snapshots').insert({
          game_id:              game.id,
          source_name:          'seatgeek',
          lowest_price:         sgPrice,
          avg_price:            event.stats?.average_price ?? null,
          median_price:         event.stats?.median_price ?? null,
          displayed_price:      sgPrice,
          base_price:           sgPrice,
          pricing_transparency: 'base_price_only',
          affiliate_url:        event.url,
          listing_count:        event.stats?.listing_count ?? null,
          captured_at:          new Date().toISOString(),
        });
      }

      totalMatched++;
    }
  }

  return { matched: totalMatched, skipped: totalSkipped };
}

// ─────────────────────────────────────────────
// FIFA WORLD CUP — per-match SeatGeek attachment
// ─────────────────────────────────────────────
//
// The regular attachSeatGeekPricingForCity loop is team-based: each
// teams.seatgeek_slug → SG performer → match SG events back to ESPN games
// by home_team_id. National teams don't fit that — there's no
// "Brazil's home" because they're touring the host country — but SG
// happens to ship the entire tournament under a single performer
// (`slug=fifa-world-cup`, id=10400, 104 events) and per-venue venue IDs.
//
// So for WC games we instead query by performer+venue.id and match back
// to our seeded games by exact datetime_utc (within ±15 minutes — SG's
// kickoff times match FIFA's to the minute, but a small tolerance keeps
// us safe against TZ rounding). Each match gets:
//   • games.affiliate_url ← per-event SG URL
//   • pricing_snapshots row when SG has a live `lowest_price` (it
//     usually doesn't until weeks before kickoff)

const WC_VENUE_TO_SG_ID: Record<string, number> = {
  'MetLife Stadium': 1587,
  'SoFi Stadium': 487036,
};

export async function attachWCPricingForCity(
  cityId: string,
): Promise<{ matched: number; skipped: number }> {
  const supabase = createServiceClient();
  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) return { matched: 0, skipped: 0 };

  const { data: games } = await supabase
    .from('games')
    .select('id, venue, start_time, affiliate_url')
    .eq('city_id', cityId)
    .eq('league', 'FIFA-WC')
    .eq('status', 'scheduled');

  if (!games?.length) return { matched: 0, skipped: 0 };

  // Group seeded games by venue so we issue one SG query per stadium,
  // not one per game.
  const byVenue = new Map<string, typeof games>();
  for (const g of games) {
    const list = byVenue.get(g.venue) ?? [];
    list.push(g);
    byVenue.set(g.venue, list);
  }

  let matched = 0;
  let skipped = 0;

  for (const [venue, venueGames] of byVenue) {
    const sgVenueId = WC_VENUE_TO_SG_ID[venue];
    if (!sgVenueId) { skipped += venueGames.length; continue; }

    const params = new URLSearchParams({
      'performers.slug':   'fifa-world-cup',
      'venue.id':          String(sgVenueId),
      'datetime_utc.gte':  '2026-06-11T00:00:00Z',
      'datetime_utc.lte':  '2026-07-20T00:00:00Z',
      per_page:            '40',
      client_id:           clientId,
    });

    let sgEvents: SGEvent[] = [];
    try {
      const res = await fetch(`${SEATGEEK_BASE}/events?${params}`);
      if (!res.ok) { skipped += venueGames.length; continue; }
      const data = await res.json();
      sgEvents = data.events ?? [];
    } catch {
      skipped += venueGames.length;
      continue;
    }

    for (const g of venueGames) {
      const gameMs = new Date(g.start_time).getTime();
      const match = sgEvents.find(e =>
        Math.abs(new Date(e.datetime_utc).getTime() - gameMs) < 15 * 60_000
      );
      if (!match) { skipped++; continue; }

      // Persist the affiliate URL even when SG has no live price — it's
      // the per-match deep link, which is the whole reason we're here.
      if (!g.affiliate_url || g.affiliate_url.includes('seatgeek.com')) {
        await supabase.from('games').update({ affiliate_url: match.url }).eq('id', g.id);
      }

      const sgPrice = match.stats?.lowest_price ?? null;
      if (sgPrice !== null) {
        await supabase.from('pricing_snapshots')
          .delete()
          .eq('game_id', g.id)
          .eq('source_name', 'seatgeek');

        await supabase.from('pricing_snapshots').insert({
          game_id:              g.id,
          source_name:          'seatgeek',
          lowest_price:         sgPrice,
          avg_price:            match.stats?.average_price ?? null,
          median_price:         match.stats?.median_price ?? null,
          displayed_price:      sgPrice,
          base_price:           sgPrice,
          pricing_transparency: 'base_price_only',
          affiliate_url:        match.url,
          listing_count:        match.stats?.listing_count ?? null,
          captured_at:          new Date().toISOString(),
        });
      }

      matched++;
    }
  }

  return { matched, skipped };
}
