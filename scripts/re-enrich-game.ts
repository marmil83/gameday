// Force-re-enrich one or more games by ID, team-name match, or date.
//
// Bypasses the skip-if-unchanged cache via force=true so the Claude
// call always fires. Useful for:
//   • Pushing a brand-voice / scoring-prompt change live for ONE game
//     without waiting for the next pipeline cron tick
//   • Refreshing a single game after manually editing standings, prices,
//     or big-game flags
//
// Usage:
//   npx tsx scripts/re-enrich-game.ts --id=<uuid>
//   npx tsx scripts/re-enrich-game.ts --team="New York Yankees"
//   npx tsx scripts/re-enrich-game.ts --team="Yankees" --date=2026-06-08
//   npx tsx scripts/re-enrich-game.ts --team="Yankees"        # next upcoming match
//
// --team is a case-insensitive partial match against home_team_name
// AND away_team_name, so "Yankees" picks up either side.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

function arg(name: string): string | null {
  const found = process.argv.find(a => a.startsWith(`--${name}=`));
  return found ? found.split('=').slice(1).join('=') : null;
}

async function main() {
  const id = arg('id');
  const team = arg('team');
  const date = arg('date');

  if (!id && !team) {
    console.error('Usage: --id=<uuid> | --team="Yankees" [--date=YYYY-MM-DD]');
    process.exit(1);
  }

  // Lazy-load — env vars must be in process.env before claude.ts loads
  const { enrichSingleGame } = await import('../src/lib/pipeline/enrich');

  let games: { id: string; home_team_name: string; away_team_name: string; start_time: string }[] = [];

  if (id) {
    const { data } = await sb
      .from('games')
      .select('id, home_team_name, away_team_name, start_time')
      .eq('id', id);
    games = data ?? [];
  } else if (team) {
    let q = sb
      .from('games')
      .select('id, home_team_name, away_team_name, start_time')
      .or(`home_team_name.ilike.%${team}%,away_team_name.ilike.%${team}%`)
      .eq('status', 'scheduled')
      .eq('is_home_game', true)
      .order('start_time', { ascending: true });

    if (date) {
      // Local date filter — accept YYYY-MM-DD and bracket UTC to a wide
      // window since we don't know the venue timezone here. Good enough
      // for narrowing to a specific game day.
      const start = new Date(`${date}T00:00:00Z`).toISOString();
      const end = new Date(`${date}T23:59:59Z`).toISOString();
      // Widen by ±12h to absorb any timezone slop
      const startWide = new Date(new Date(start).getTime() - 12 * 3600_000).toISOString();
      const endWide = new Date(new Date(end).getTime() + 12 * 3600_000).toISOString();
      q = q.gte('start_time', startWide).lte('start_time', endWide);
    } else {
      // No date → just the next upcoming game for this team
      q = q.gte('start_time', new Date().toISOString()).limit(1);
    }

    const { data } = await q;
    games = data ?? [];
  }

  if (!games.length) {
    console.log('No matching games found.');
    return;
  }

  console.log(`Re-enriching ${games.length} game(s):\n`);
  for (const g of games) {
    const when = new Date(g.start_time).toLocaleString('en-US', { timeZone: 'America/New_York' });
    process.stdout.write(`  ${g.away_team_name} @ ${g.home_team_name} (${when}) ... `);
    try {
      await enrichSingleGame(g.id, true); // force=true → bypass cache
      console.log('OK');
    } catch (err) {
      console.log('FAILED:', (err as Error).message);
    }
  }
  console.log('\nDone.');
}

main().then(() => process.exit(0));
