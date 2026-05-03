// Fetch team standings/records from free sports APIs
// Sources: MLB Stats API (MLB, MiLB), ESPN (NBA, NFL, MLS, NWSL), NHL API
// Usage: npx tsx scripts/fetch-standings.ts

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface StandingsData {
  wins: number;
  losses: number;
  winPct: number;
  streak: string | null;
}

// ── MLB & MiLB (MLB Stats API - free, no key) ──

async function fetchMLBStandings(): Promise<Map<string, StandingsData>> {
  const results = new Map<string, StandingsData>();
  // leagueId: 103=AL, 104=NL
  const res = await fetch('https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=2026');
  const data = await res.json();

  for (const record of data.records || []) {
    for (const t of record.teamRecords || []) {
      const name = t.team.name;
      results.set(name, {
        wins: t.wins,
        losses: t.losses,
        winPct: parseFloat(t.winningPercentage) || 0,
        streak: t.streak?.streakCode || null,
      });
    }
  }
  return results;
}

async function fetchMiLBStandings(): Promise<Map<string, StandingsData>> {
  const results = new Map<string, StandingsData>();
  // MiLB league IDs: 104=International League (AAA), 117=Eastern League (AA) + others
  // sportId=11 for AAA, 12 for AA, 13 for High-A, 14 for Single-A
  for (const sportId of [11, 12, 13]) {
    try {
      const res = await fetch(`https://statsapi.mlb.com/api/v1/standings?sportId=${sportId}&season=2026`);
      const data = await res.json();
      for (const record of data.records || []) {
        for (const t of record.teamRecords || []) {
          const name = t.team.name;
          results.set(name, {
            wins: t.wins,
            losses: t.losses,
            winPct: parseFloat(t.winningPercentage) || 0,
            streak: t.streak?.streakCode || null,
          });
        }
      }
    } catch (e) {
      console.error(`  MiLB sportId=${sportId} failed:`, e);
    }
  }
  return results;
}

// ── NHL (NHL API - free, no key) ──

async function fetchNHLStandings(): Promise<Map<string, StandingsData>> {
  const results = new Map<string, StandingsData>();
  const res = await fetch('https://api-web.nhle.com/v1/standings/now');
  const data = await res.json();

  for (const t of data.standings || []) {
    const name = `${t.teamName?.default}`;
    const fullName = `${t.placeName?.default} ${name}`;
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
  return results;
}

// ── NBA, NFL, MLS, NWSL (ESPN API - free, no key) ──

async function fetchESPNStandings(sport: string, league: string): Promise<Map<string, StandingsData>> {
  const results = new Map<string, StandingsData>();
  try {
    const res = await fetch(`https://site.api.espn.com/apis/v2/sports/${sport}/${league}/standings`);
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
          streak: stats.streak ? (stats.streak > 0 ? `W${Math.round(stats.streak)}` : `L${Math.round(Math.abs(stats.streak))}`) : null,
        });
      }
    }
  } catch (e) {
    console.error(`  ESPN ${sport}/${league} failed:`, e);
  }
  return results;
}

// ── Match team name fuzzy ──

function findTeamStandings(teamName: string, standingsMap: Map<string, StandingsData>): StandingsData | null {
  // Exact match
  if (standingsMap.has(teamName)) return standingsMap.get(teamName)!;

  // Partial match (e.g. "Detroit Tigers" in "Tigers")
  for (const [key, val] of standingsMap) {
    if (key.includes(teamName) || teamName.includes(key)) return val;
    // Match on last word (e.g. "Tigers", "Pistons")
    const keyLast = key.split(' ').pop()?.toLowerCase();
    const nameLast = teamName.split(' ').pop()?.toLowerCase();
    if (keyLast && nameLast && keyLast === nameLast) return val;
  }

  return null;
}

async function main() {
  console.log('Fetching standings from free APIs...\n');

  // Fetch all standings in parallel
  const [mlb, milb, nhl, nba, nfl, mls, nwsl, wnba] = await Promise.all([
    fetchMLBStandings().catch(() => new Map<string, StandingsData>()),
    fetchMiLBStandings().catch(() => new Map<string, StandingsData>()),
    fetchNHLStandings().catch(() => new Map<string, StandingsData>()),
    fetchESPNStandings('basketball', 'nba').catch(() => new Map<string, StandingsData>()),
    fetchESPNStandings('football', 'nfl').catch(() => new Map<string, StandingsData>()),
    fetchESPNStandings('soccer', 'usa.1').catch(() => new Map<string, StandingsData>()), // MLS
    fetchESPNStandings('soccer', 'usa.nwsl').catch(() => new Map<string, StandingsData>()),
    fetchESPNStandings('basketball', 'wnba').catch(() => new Map<string, StandingsData>()),
  ]);

  console.log(`  MLB: ${mlb.size} teams, MiLB: ${milb.size} teams, NHL: ${nhl.size} teams`);
  console.log(`  NBA: ${nba.size} teams, NFL: ${nfl.size} teams, MLS: ${mls.size} teams, NWSL: ${nwsl.size} teams, WNBA: ${wnba.size} teams\n`);

  // Map league to standings source
  const leagueMap: Record<string, Map<string, StandingsData>> = {
    'MLB': mlb,
    'MiLB-AAA': milb,
    'MiLB-AA': milb,
    'MiLB-A+': milb,
    'NHL': nhl,
    'NBA': nba,
    'NFL': nfl,
    'MLS': mls,
    'NWSL': nwsl,
    'WNBA': wnba,
  };

  // Get all our teams
  const { data: teams } = await supabase.from('teams').select('id, name, league');
  if (!teams) {
    console.error('Failed to fetch teams');
    return;
  }

  let updated = 0;
  for (const team of teams) {
    const standingsSource = leagueMap[team.league];
    if (!standingsSource) {
      console.log(`[${team.league}] ${team.name}: no standings source`);
      continue;
    }

    const standings = findTeamStandings(team.name, standingsSource);
    if (!standings) {
      console.log(`[${team.league}] ${team.name}: not found in standings`);
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
      console.error(`[${team.league}] ${team.name}: DB error: ${error.message}`);
    } else {
      console.log(`[${team.league}] ${team.name}: ${standings.wins}-${standings.losses} (${(standings.winPct * 100).toFixed(1)}%) streak: ${standings.streak}`);
      updated++;
    }
  }

  console.log(`\nDone! Updated ${updated}/${teams.length} teams.`);
}

main();
