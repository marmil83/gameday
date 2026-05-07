import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function main() {
  const { data: games } = await sb
    .from('games')
    .select(`id, home_team_name, away_team_name, league, start_time,
      scores(deal_score, price_score, experience_score, game_quality_score, timing_score, context_score, score_breakdown),
      game_insights(context_flags),
      pricing_snapshots(lowest_price)`)
    .or('home_team_name.ilike.%Ducks%,home_team_name.ilike.%Lakers%')
    .eq('is_home_game', true)
    .eq('status', 'scheduled')
    .gte('start_time', new Date().toISOString())
    .order('start_time');
  for (const g of games || []) {
    const s: any = Array.isArray(g.scores) ? g.scores[0] : g.scores;
    const i: any = Array.isArray(g.game_insights) ? g.game_insights[0] : g.game_insights;
    const cheapest = (g.pricing_snapshots as any[])?.filter(p => p.lowest_price != null).sort((a, b) => a.lowest_price - b.lowest_price)[0];
    console.log(`\n[${g.league}] ${g.away_team_name} @ ${g.home_team_name}  ${g.start_time?.slice(0, 10)}`);
    console.log(`  flags:`, i?.context_flags);
    console.log(`  cheapest price: $${cheapest?.lowest_price ?? '(none)'}`);
    console.log(`  Deal: ${s?.deal_score}  | Price: ${s?.price_score}  Exp: ${s?.experience_score}  Quality: ${s?.game_quality_score}  Timing: ${s?.timing_score}  Context: ${s?.context_score}`);
    console.log(`  price reasoning:`, s?.score_breakdown?.price?.reasoning);
    console.log(`  exp reasoning:  `, s?.score_breakdown?.experience?.reasoning);
    console.log(`  quality reasoning:`, s?.score_breakdown?.gameQuality?.reasoning);
  }
}
main();
