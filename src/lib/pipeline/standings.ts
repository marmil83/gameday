// Standings Sync Pipeline
// Fetches current team records from free sports APIs and updates the teams table.
// Sources: MLB Stats API (MLB, MiLB) · NHL API · ESPN (NBA, NFL, MLS, NWSL, WNBA)
// No API keys required. Safe to run daily.

import { createServiceClient } from '../supabase/server';

interface StandingsData {
  wins: number;
  losses: number;
  // Soccer leagues (MLS/NWSL) have draws. Captured separately so they don't
  // get lost when computing total games or win_pct. Null for win/loss-only
  // leagues (MLB/NBA/NHL/NFL/WNBA/MiLB).
  ties: number | null;
  // Draws-aware win_pct — for soccer this is (W + D/2) / GP so a tie counts
  // as half a win. For other leagues it's the standard W/(W+L).
  winPct: number;
  streak: string | null;
  // Recent form — richer signal than streak alone. Either source-provided
  // (NHL l10*, MLB lastTen splitRecord, ESPN "Last Ten Games" stat) or null.
  last10Wins: number | null;
  last10Losses: number | null;
  // Logo URL when the standings source provides it. Used when auto-inserting
  // away teams that aren't yet in the teams table.
  logoUrl: string | null;
}

// ── MLB & MiLB (MLB Stats API) ──────────────────────────────────────────────

async function fetchMLBStandings(): Promise<Map<string, StandingsData>> {
  const results = new Map<string, StandingsData>();
  try {
    const res = await fetch('https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026', {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    for (const record of data.records || []) {
      for (const t of record.teamRecords || []) {
        const last10 = (t.records?.splitRecords || []).find((s: { type: string }) => s.type === 'lastTen');
        const teamId = t.team?.id;
        results.set(t.team.name, {
          wins: t.wins,
          losses: t.losses,
          winPct: parseFloat(t.winningPercentage) || 0,
          streak: t.streak?.streakCode || null,
          ties: null,
          last10Wins: last10?.wins ?? null,
          last10Losses: last10?.losses ?? null,
          // MLB API doesn't expose logo URL — use ESPN's MLB logo CDN by team id
          logoUrl: teamId ? `https://a.espncdn.com/i/teamlogos/mlb/500/${teamId}.png` : null,
        });
      }
    }
  } catch (e) {
    console.error('  MLB standings fetch failed:', e);
  }
  return results;
}

async function fetchMiLBStandings(): Promise<Map<string, StandingsData>> {
  const results = new Map<string, StandingsData>();
  // MiLB uses leagueId, not sportId. Active league IDs span 110-128.
  // We fetch all at once and build one shared map used for all MiLB-* tiers.
  const MILB_LEAGUE_IDS = '110,111,112,113,116,117,118,120,121,122,123,124,125,126,128';
  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1/standings?leagueId=${MILB_LEAGUE_IDS}&season=2026`,
      { signal: AbortSignal.timeout(15_000) }
    );
    const data = await res.json();
    for (const record of data.records || []) {
      for (const t of record.teamRecords || []) {
        const last10 = (t.records?.splitRecords || []).find((s: { type: string }) => s.type === 'lastTen');
        results.set(t.team.name, {
          wins: t.wins,
          losses: t.losses,
          winPct: parseFloat(t.winningPercentage) || 0,
          streak: t.streak?.streakCode || null,
          ties: null,
          last10Wins: last10?.wins ?? null,
          last10Losses: last10?.losses ?? null,
          logoUrl: null, // MiLB logos vary widely — leave null, let manual seeds win
        });
      }
    }
  } catch (e) {
    console.error('  MiLB standings fetch failed:', e);
  }
  return results;
}

// ── NHL (NHL API) ────────────────────────────────────────────────────────────

async function fetchNHLStandings(): Promise<Map<string, StandingsData>> {
  const results = new Map<string, StandingsData>();
  try {
    const res = await fetch('https://api-web.nhle.com/v1/standings/now', {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    for (const t of data.standings || []) {
      const fullName = `${t.placeName?.default} ${t.teamName?.default}`;
      const w = t.wins || 0;
      const l = t.losses || 0;
      const total = w + l + (t.otLosses || 0);
      // NHL exposes l10Wins / l10Losses / l10OtLosses
      const l10W = t.l10Wins ?? null;
      const l10L = (t.l10Losses ?? null) !== null
        ? (t.l10Losses ?? 0) + (t.l10OtLosses ?? 0)
        : null;
      results.set(fullName, {
        wins: w,
        losses: l,
        ties: null, // NHL has overtime losses, not ties — tracked in `total` already
        winPct: total > 0 ? w / total : 0,
        streak: t.streakCode || null,
        last10Wins: l10W,
        last10Losses: l10L,
        logoUrl: t.teamLogo || null,
      });
    }
  } catch (e) {
    console.error('  NHL standings fetch failed:', e);
  }
  return results;
}

// ── NBA, WNBA, NFL, MLS, NWSL (ESPN API) ────────────────────────────────────

async function fetchESPNStandings(sport: string, league: string, hasTies = false): Promise<Map<string, StandingsData>> {
  const results = new Map<string, StandingsData>();
  try {
    const res = await fetch(`https://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    for (const child of data.children || []) {
      for (const entry of child.standings?.entries || []) {
        const name = entry.team?.displayName;
        if (!name) continue;
        const stats: Record<string, number> = {};
        // ESPN's "Last Ten Games" comes through as a displayValue like "7-3"
        // — parse separately because numeric value is just sum of wins.
        let last10Wins: number | null = null;
        let last10Losses: number | null = null;
        for (const s of entry.stats || []) {
          const key = s.name || s.type;
          const val = s.value ?? (typeof s.displayValue === 'string' ? parseFloat(s.displayValue) : undefined);
          if (key && val !== undefined) stats[key] = val;
          if (s.name === 'Last Ten Games' || s.type === 'lastTen' || s.shortDisplayName === 'L10') {
            const m = String(s.displayValue || '').match(/^(\d+)-(\d+)/);
            if (m) { last10Wins = parseInt(m[1]); last10Losses = parseInt(m[2]); }
          }
        }
        const w = stats.wins || 0;
        const l = stats.losses || 0;
        // Soccer leagues report ties under "ties" or via gamesPlayed - W - L
        const ties = hasTies
          ? (stats.ties ?? Math.max(0, (stats.gamesPlayed || 0) - w - l))
          : null;
        const totalGames = w + l + (ties || 0);
        // Draws-aware win_pct: tie counts as half a win for soccer.
        // For other leagues this collapses to standard W/(W+L).
        const winPct = hasTies
          ? (totalGames > 0 ? (w + (ties || 0) * 0.5) / totalGames : 0)
          : (stats.winPercent || stats.winPercentage || (w + l > 0 ? w / (w + l) : 0));
        const logoUrl = entry.team?.logos?.[0]?.href ?? null;
        results.set(name, {
          wins: w,
          losses: l,
          ties,
          winPct,
          streak: stats.streak
            ? stats.streak > 0 ? `W${Math.round(stats.streak)}` : `L${Math.round(Math.abs(stats.streak))}`
            : null,
          last10Wins,
          last10Losses,
          logoUrl,
        });
      }
    }
  } catch (e) {
    console.error(`  ESPN ${sport}/${league} standings fetch failed:`, e);
  }
  return results;
}

// ── Name matching ─────────────────────────────────────────────────────────────

function findTeamStandings(teamName: string, standingsMap: Map<string, StandingsData>): StandingsData | null {
  if (standingsMap.has(teamName)) return standingsMap.get(teamName)!;
  for (const [key, val] of standingsMap) {
    if (key.includes(teamName) || teamName.includes(key)) return val;
    const keyLast = key.split(' ').pop()?.toLowerCase();
    const nameLast = teamName.split(' ').pop()?.toLowerCase();
    if (keyLast && nameLast && keyLast === nameLast) return val;
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function updateStandings(): Promise<{ updated: number; errors: string[] }> {
  const supabase = createServiceClient();
  const errors: string[] = [];

  console.log('[Standings] Fetching from MLB Stats API, NHL API, and ESPN...');

  // Fetch all in parallel
  const [mlb, milb, nhl, nba, nfl, mls, nwsl, wnba] = await Promise.all([
    fetchMLBStandings(),
    fetchMiLBStandings(),
    fetchNHLStandings(),
    fetchESPNStandings('basketball', 'nba'),
    fetchESPNStandings('football', 'nfl'),
    fetchESPNStandings('soccer', 'usa.1', true),       // MLS — has ties
    fetchESPNStandings('soccer', 'usa.nwsl', true),    // NWSL — has ties
    fetchESPNStandings('basketball', 'wnba'),
  ]);

  console.log(`[Standings] MLB:${mlb.size} MiLB:${milb.size} NHL:${nhl.size} NBA:${nba.size} NFL:${nfl.size} MLS:${mls.size} NWSL:${nwsl.size} WNBA:${wnba.size}`);

  const leagueMap: Record<string, Map<string, StandingsData>> = {
    MLB: mlb,
    'MiLB-AAA': milb, 'MiLB-AA': milb, 'MiLB-A+': milb,
    NHL: nhl,
    NBA: nba,
    NFL: nfl,
    MLS: mls,
    NWSL: nwsl,
    WNBA: wnba,
  };

  const { data: teams, error: teamsError } = await supabase.from('teams').select('id, name, league, external_ids');
  if (teamsError || !teams) {
    return { updated: 0, errors: ['Failed to fetch teams from DB'] };
  }

  // Build a quick lookup of team-name → existing record so we can detect
  // missing away teams below without re-querying.
  const knownTeamNames = new Set((teams as Array<{ name: string }>).map(t => t.name.toLowerCase()));

  let updated = 0;
  for (const team of teams as Array<{ id: string; name: string; league: string; external_ids: Record<string, unknown> | null }>) {
    const source = leagueMap[team.league];
    if (!source) continue; // AHL, WHL, USL — no free API yet

    const standings = findTeamStandings(team.name, source);
    if (!standings) {
      console.log(`[Standings] [${team.league}] ${team.name}: not found`);
      continue;
    }

    // Persist last_10 + soccer ties in external_ids (no schema change needed).
    const externalIds = { ...(team.external_ids || {}) };
    if (standings.last10Wins != null && standings.last10Losses != null) {
      externalIds.last_10_wins = standings.last10Wins;
      externalIds.last_10_losses = standings.last10Losses;
    }
    if (standings.ties != null) {
      externalIds.ties = standings.ties;
    }

    const { error } = await supabase
      .from('teams')
      .update({
        wins: standings.wins,
        losses: standings.losses,
        win_pct: standings.winPct,
        streak: standings.streak,
        external_ids: externalIds,
        standings_updated_at: new Date().toISOString(),
      })
      .eq('id', team.id);

    if (error) {
      errors.push(`[${team.league}] ${team.name}: ${error.message}`);
    } else {
      const last10Str = standings.last10Wins != null ? ` L10:${standings.last10Wins}-${standings.last10Losses}` : '';
      console.log(`[Standings] [${team.league}] ${team.name}: ${standings.wins}-${standings.losses} ${standings.streak || ''}${last10Str}`);
      updated++;
    }
  }

  // ── Auto-discover & insert away teams not yet in our DB ────────────────
  // The point of standings is to inform game-quality scoring. If we're
  // showing Lakers vs Thunder and Thunder isn't in our teams table, we
  // silently treat them as a .500 team — bad signal. So pull every unique
  // away team that appears in upcoming home games and seed them under the
  // External placeholder city with full standings.
  const { data: external } = await supabase
    .from('cities')
    .select('id')
    .ilike('name', 'External')
    .single();

  if (external) {
    const { data: upcoming } = await supabase
      .from('games')
      .select('away_team_name, league')
      .eq('is_home_game', true)
      .eq('status', 'scheduled')
      .gte('start_time', new Date().toISOString());

    const seen = new Set<string>();
    let inserted = 0;
    for (const g of upcoming || []) {
      const name = g.away_team_name?.trim();
      if (!name || name === 'TBD') continue;
      const key = `${g.league}:${name.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (knownTeamNames.has(name.toLowerCase())) continue;

      const source = leagueMap[g.league];
      if (!source) continue;
      const standings = findTeamStandings(name, source);
      if (!standings) {
        console.log(`[Standings] external [${g.league}] ${name}: not found in feed`);
        continue;
      }

      const newRow = {
        name,
        short_name: name.split(' ').slice(-1)[0] || name,
        abbreviation: null,
        league: g.league,
        league_level: 'major',
        city_id: external.id,
        venue_name: null,
        venue_type: null,
        logo_url: standings.logoUrl,
        seatgeek_slug: null,
        wins: standings.wins,
        losses: standings.losses,
        win_pct: standings.winPct,
        streak: standings.streak,
        external_ids: {
          ...(standings.last10Wins != null && standings.last10Losses != null
            ? { last_10_wins: standings.last10Wins, last_10_losses: standings.last10Losses }
            : {}),
          ...(standings.ties != null ? { ties: standings.ties } : {}),
        },
        standings_updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('teams').insert(newRow);
      if (error) {
        errors.push(`Insert external [${g.league}] ${name}: ${error.message}`);
      } else {
        console.log(`[Standings] external [${g.league}] ${name}: inserted ${standings.wins}-${standings.losses}`);
        inserted++;
        knownTeamNames.add(name.toLowerCase());
      }
    }
    if (inserted > 0) console.log(`[Standings] Inserted ${inserted} external away team(s)`);
  }

  console.log(`[Standings] Done — updated ${updated}/${teams.length} teams`);
  return { updated, errors };
}
