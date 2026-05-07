// Standings Sync Pipeline
// Fetches current team records from free sports APIs and updates the teams table.
// Sources: MLB Stats API (MLB, MiLB) · NHL API · ESPN (NBA, NFL, MLS, NWSL, WNBA)
// No API keys required. Safe to run daily.

import { createServiceClient } from '../supabase/server';

interface StandingsData {
  wins: number;
  losses: number;
  winPct: number;
  streak: string | null;
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
        results.set(t.team.name, {
          wins: t.wins,
          losses: t.losses,
          winPct: parseFloat(t.winningPercentage) || 0,
          streak: t.streak?.streakCode || null,
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
        results.set(t.team.name, {
          wins: t.wins,
          losses: t.losses,
          winPct: parseFloat(t.winningPercentage) || 0,
          streak: t.streak?.streakCode || null,
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
      results.set(fullName, {
        wins: w,
        losses: l,
        winPct: total > 0 ? w / total : 0,
        streak: t.streakCode || null,
      });
    }
  } catch (e) {
    console.error('  NHL standings fetch failed:', e);
  }
  return results;
}

// ── NBA, WNBA, NFL, MLS, NWSL (ESPN API) ────────────────────────────────────

async function fetchESPNStandings(sport: string, league: string): Promise<Map<string, StandingsData>> {
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
        for (const s of entry.stats || []) {
          const key = s.name || s.type;
          const val = s.value ?? (typeof s.displayValue === 'string' ? parseFloat(s.displayValue) : undefined);
          if (key && val !== undefined) stats[key] = val;
        }
        const w = stats.wins || 0;
        const l = stats.losses || 0;
        const total = w + l;
        results.set(name, {
          wins: w,
          losses: l,
          winPct: stats.winPercent || stats.winPercentage || (total > 0 ? w / total : 0),
          streak: stats.streak
            ? stats.streak > 0 ? `W${Math.round(stats.streak)}` : `L${Math.round(Math.abs(stats.streak))}`
            : null,
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
    fetchESPNStandings('soccer', 'usa.1'),       // MLS
    fetchESPNStandings('soccer', 'usa.nwsl'),
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

  const { data: teams, error: teamsError } = await supabase.from('teams').select('id, name, league');
  if (teamsError || !teams) {
    return { updated: 0, errors: ['Failed to fetch teams from DB'] };
  }

  let updated = 0;
  for (const team of teams) {
    const source = leagueMap[team.league];
    if (!source) continue; // AHL, WHL, USL — no free API yet

    const standings = findTeamStandings(team.name, source);
    if (!standings) {
      console.log(`[Standings] [${team.league}] ${team.name}: not found`);
      continue;
    }

    const { error } = await supabase
      .from('teams')
      .update({
        wins: standings.wins,
        losses: standings.losses,
        win_pct: standings.winPct,
        streak: standings.streak,
        standings_updated_at: new Date().toISOString(),
      })
      .eq('id', team.id);

    if (error) {
      errors.push(`[${team.league}] ${team.name}: ${error.message}`);
    } else {
      console.log(`[Standings] [${team.league}] ${team.name}: ${standings.wins}-${standings.losses} ${standings.streak || ''}`);
      updated++;
    }
  }

  console.log(`[Standings] Done — updated ${updated}/${teams.length} teams`);
  return { updated, errors };
}
