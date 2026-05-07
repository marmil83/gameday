// Find playoff games whose context_flags don't include a round slug.
// These are stale — the round must be inferred and prices may be wrong.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const ROUNDS = ['first-round', 'conference-semis', 'conference-finals', 'finals'];
async function main() {
  const { data } = await sb
    .from('game_insights')
    .select('game_id, context_flags');
  const stale = (data || []).filter(r => {
    const flags = (r.context_flags as string[]) || [];
    const isPlayoff = flags.includes('playoff') || flags.includes('elimination') || flags.includes('finals');
    const hasRound = flags.some(f => ROUNDS.includes(f));
    return isPlayoff && !hasRound;
  });
  for (const s of stale) {
    const { data: g } = await sb.from('games').select('home_team_name, away_team_name, league, start_time, status, is_home_game').eq('id', s.game_id).single();
    if (g?.status !== 'scheduled' || !g.is_home_game) continue;
    if (new Date(g.start_time) < new Date()) continue;
    console.log(s.game_id, '|', g?.league, g?.away_team_name, '@', g?.home_team_name, '|', g?.start_time?.slice(0, 10), '|', s.context_flags);
  }
  console.log(`\nDone.`);
}
main();
