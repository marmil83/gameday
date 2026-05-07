// Event Ingestion Pipeline
// Fetches upcoming games from SeatGeek API and normalizes into our schema

import { createServiceClient } from '../supabase/server';
import type { Team } from '@/types/database';

interface SeatGeekEvent {
  id: number;
  title: string;
  datetime_utc: string;
  datetime_local: string;
  venue: {
    name: string;
    city: string;
    state: string;
  };
  performers: {
    name: string;
    slug: string;
    home_team?: boolean;
  }[];
  stats: {
    lowest_price: number | null;
    average_price: number | null;
    median_price: number | null;
    listing_count: number | null;
  };
  url: string;
  type: string;
}

interface SeatGeekResponse {
  events: SeatGeekEvent[];
  meta: { total: number; page: number; per_page: number };
}

const SEATGEEK_BASE = 'https://api.seatgeek.com/2';

/**
 * Fetch events from SeatGeek for a specific team
 */
async function fetchSeatGeekEvents(
  teamSlug: string,
  daysAhead: number = 7
): Promise<SeatGeekEvent[]> {
  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) {
    console.warn('SeatGeek API key not configured — skipping event fetch');
    return [];
  }

  const now = new Date();
  const future = new Date(now);
  future.setDate(future.getDate() + daysAhead);

  const params = new URLSearchParams({
    'performers.slug': teamSlug,
    'datetime_utc.gte': now.toISOString(),
    'datetime_utc.lte': future.toISOString(),
    client_id: clientId,
    per_page: '25',
  });

  const url = `${SEATGEEK_BASE}/events?${params}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`SeatGeek API error for ${teamSlug}: ${response.status}`);
      return [];
    }
    const data: SeatGeekResponse = await response.json();
    return data.events;
  } catch (error) {
    console.error(`Failed to fetch SeatGeek events for ${teamSlug}:`, error);
    return [];
  }
}

/**
 * Ingest events for all teams in a city
 */
export async function ingestEventsForCity(cityId: string): Promise<{
  found: number;
  inserted: number;
  errors: string[];
}> {
  const supabase = createServiceClient();
  const errors: string[] = [];

  // Get all teams for this city
  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .eq('city_id', cityId);

  if (teamsError || !teams) {
    return { found: 0, inserted: 0, errors: [`Failed to fetch teams: ${teamsError?.message}`] };
  }

  let totalFound = 0;
  let totalInserted = 0;

  for (const team of teams as Team[]) {
    if (!team.seatgeek_slug) continue;

    // Major-league games are owned by ESPN (espn-events.ts).
    // SeatGeek is used only for minor leagues here — pricing for major leagues
    // is attached separately by attachSeatGeekPricingForCity.
    if (team.league_level === 'major') continue;

    const events = await fetchSeatGeekEvents(team.seatgeek_slug);
    totalFound += events.length;

    for (const event of events) {
      const homePerformer = event.performers.find(p => p.home_team === true);
      const awayPerformer = event.performers.find(p => p.home_team !== true);

      // Determine if this is a home game by checking venue against team's home venue
      const isHomeGame = team.venue_name
        ? event.venue.name.toLowerCase().includes(team.venue_name.split(' ')[0].toLowerCase())
        : homePerformer?.name === team.name;

      // Normalise away team name — SeatGeek uses league/round strings like
      // "NBA Western Conference Semifinals" or the home team itself for TBD matchups
      const rawAwayName = awayPerformer?.name || '';
      const homeName = homePerformer?.name || team.name;
      const isTbdAway =
        !rawAwayName ||
        rawAwayName === homeName ||
        /^(nba|nhl|mlb|nfl|mls|ahl|whl|wnba|nwsl|usl|milb)/i.test(rawAwayName);
      const awayTeamName = isTbdAway ? 'TBD' : rawAwayName;

      // ── Phantom event guard ──────────────────────────────────────────────────
      // SeatGeek pre-lists "if" playoff tickets for EVERY team (even eliminated ones)
      // using a fake placeholder start time — always 10:30 UTC (3:30 AM Pacific,
      // 6:30 AM Eastern). No real sporting event starts before 10 AM local time.
      // These phantom events flood the DB with games that will never happen.
      // Detect them by: TBD opponent + suspiciously early local hour.
      if (awayTeamName === 'TBD') {
        const localHour = parseInt(event.datetime_local.split('T')[1]?.split(':')[0] ?? '12');
        if (localHour < 10) {
          // Phantom — skip. Don't log per-event; too noisy. Caller sees skipped count.
          continue;
        }
      }

      const gameData = {
        home_team_id: team.id,
        away_team_id: team.id,
        home_team_name: homeName,
        away_team_name: awayTeamName,
        league: team.league,
        venue: event.venue.name,
        city_id: cityId,
        start_time: event.datetime_utc,
        status: 'scheduled' as const,
        source: 'seatgeek',
        source_event_id: String(event.id),
        affiliate_url: event.url,
        is_home_game: isHomeGame,
      };

      // Upsert — don't duplicate events.
      // ignoreDuplicates: false so pricing/affiliate_url stay fresh,
      // but we use a merge that won't revert a corrected away_team_name.
      const { error: insertError } = await supabase
        .from('games')
        .upsert(gameData, {
          onConflict: 'source_event_id,source',
          ignoreDuplicates: false,
        });

      if (insertError) {
        errors.push(`Failed to insert event ${event.id}: ${insertError.message}`);
      } else {
        totalInserted++;
      }

      // Also store SeatGeek pricing snapshot (delete+insert so re-runs stay fresh)
      const { data: insertedGame } = await supabase
        .from('games')
        .select('id')
        .eq('source_event_id', String(event.id))
        .eq('source', 'seatgeek')
        .single();

      if (insertedGame?.id) {
        // Always update affiliate_url so we have a ticket link.
        await supabase.from('games')
          .update({ affiliate_url: event.url })
          .eq('id', insertedGame.id);

        // Only write a pricing snapshot when SeatGeek has a real price.
        // Null snapshots must never shadow a real TickPick price captured earlier.
        const sgPrice = event.stats?.lowest_price ?? null;
        if (sgPrice !== null) {
          await supabase
            .from('pricing_snapshots')
            .delete()
            .eq('game_id', insertedGame.id)
            .eq('source_name', 'seatgeek');

          await supabase.from('pricing_snapshots').insert({
            game_id: insertedGame.id,
            source_name: 'seatgeek',
            lowest_price: sgPrice,
            avg_price: event.stats?.average_price ?? null,
            median_price: event.stats?.median_price ?? null,
            displayed_price: sgPrice,
            base_price: sgPrice,
            pricing_transparency: 'base_price_only',
            affiliate_url: event.url,
            listing_count: event.stats?.listing_count ?? null,
            captured_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  return { found: totalFound, inserted: totalInserted, errors };
}

/**
 * Refresh pricing for existing games
 */
export async function refreshPricing(gameId: string): Promise<void> {
  const supabase = createServiceClient();

  const { data: game } = await supabase
    .from('games')
    .select('source_event_id, source, affiliate_url')
    .eq('id', gameId)
    .single();

  if (!game?.source_event_id || game.source !== 'seatgeek') return;

  const clientId = process.env.SEATGEEK_CLIENT_ID;
  if (!clientId) return;

  try {
    const response = await fetch(
      `${SEATGEEK_BASE}/events/${game.source_event_id}?client_id=${clientId}`
    );
    if (!response.ok) return;

    const event: SeatGeekEvent = (await response.json());

    if (event.stats.lowest_price) {
      await supabase.from('pricing_snapshots').insert({
        game_id: gameId,
        source_name: 'seatgeek',
        lowest_price: event.stats.lowest_price,
        avg_price: event.stats.average_price,
        median_price: event.stats.median_price,
        displayed_price: event.stats.lowest_price,
        base_price: event.stats.lowest_price,
        pricing_transparency: 'base_price_only',
        affiliate_url: event.url,
        listing_count: event.stats.listing_count,
      });
    }
  } catch (error) {
    console.error(`Failed to refresh pricing for game ${gameId}:`, error);
  }
}
