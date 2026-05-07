// Re-enrich games whose insights contain "playoff-caliber" / similar hedge language.
// Run after the hedge-language ban is deployed.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Dynamic import — env must be loaded before claude.ts instantiates Anthropic client
  const { enrichSingleGame } = await import('../src/lib/pipeline/enrich');
  const { data } = await sb.from('game_insights').select('game_id, why_worth_it, verdict, expectation_summary');
  const hedges = /playoff[- ](caliber|level|like|style|implication|atmosphere|intensity)|feels like.*playoff|playoff[- ]worthy/i;
  const hits = (data || []).filter(r => hedges.test([r.why_worth_it, r.verdict, r.expectation_summary].filter(Boolean).join(' ')));

  console.log(`Re-enriching ${hits.length} hedged games\n`);

  for (const h of hits) {
    const { data: g } = await sb.from('games').select('home_team_name, away_team_name, league, is_home_game').eq('id', h.game_id).single();
    if (!g) continue;
    process.stdout.write(`[${g.league}] ${g.away_team_name} @ ${g.home_team_name}${g.is_home_game ? '' : ' (away)'} ... `);
    try {
      await enrichSingleGame(h.game_id);
      console.log('OK');
    } catch (err) {
      console.log('FAILED:', err);
    }
  }
  console.log('\nDone.');
}
main();
