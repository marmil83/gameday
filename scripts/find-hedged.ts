import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data } = await sb.from('game_insights').select('game_id, why_worth_it, verdict, expectation_summary, context_flags');
  const hedges = /playoff[- ](caliber|level|like|style|implication|atmosphere|intensity)|feels like.*playoff|playoff[- ]worthy/i;
  const hits = (data || []).filter(r => hedges.test([r.why_worth_it, r.verdict, r.expectation_summary].filter(Boolean).join(' ')));
  for (const h of hits) {
    const { data: g } = await sb.from('games').select('home_team_name, away_team_name, league, start_time').eq('id', h.game_id).single();
    console.log(h.game_id, '|', g?.league, g?.away_team_name, '@', g?.home_team_name, '|', g?.start_time?.slice(0, 10));
    console.log('  flags:', h.context_flags);
    console.log('  why:', h.why_worth_it);
  }
  console.log(`\n${hits.length} hedged games found`);
}
main();
