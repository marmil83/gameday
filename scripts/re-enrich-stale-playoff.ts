// Re-enrich playoff games that are missing round slugs.
// Pulls fresh AI enrichment + the latest combined ESPN/Claude playoff detection.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ROUNDS = ['first-round', 'conference-semis', 'conference-finals', 'finals'];

async function main() {
  // Dynamic import — env must be loaded before claude.ts instantiates the SDK
  const { enrichSingleGame } = await import('../src/lib/pipeline/enrich');

  const { data } = await sb.from('game_insights').select('game_id, context_flags');
  const stale = (data || []).filter(r => {
    const flags = (r.context_flags as string[]) || [];
    const isPlayoff = flags.includes('playoff') || flags.includes('elimination') || flags.includes('finals');
    const hasRound = flags.some(f => ROUNDS.includes(f));
    return isPlayoff && !hasRound;
  });

  let count = 0;
  for (const s of stale) {
    const { data: g } = await sb.from('games').select('home_team_name, away_team_name, league, start_time, status, is_home_game').eq('id', s.game_id).single();
    if (g?.status !== 'scheduled' || !g.is_home_game) continue;
    if (new Date(g.start_time) < new Date()) continue;
    process.stdout.write(`[${g.league}] ${g.away_team_name} @ ${g.home_team_name} ${g.start_time?.slice(0, 10)} ... `);
    try {
      await enrichSingleGame(s.game_id);
      console.log('OK');
      count++;
    } catch (err) {
      console.log('FAILED:', err);
    }
  }
  console.log(`\nRe-enriched ${count} stale playoff game(s).`);
}
main();
