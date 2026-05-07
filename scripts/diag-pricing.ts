import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: games } = await supabase
    .from('games')
    .select('id, home_team_name, away_team_name, league, start_time, source')
    .eq('is_home_game', true)
    .eq('status', 'scheduled')
    .in('league', ['NBA', 'NHL', 'MLB', 'NFL', 'MLS', 'NWSL', 'WNBA'])
    .gte('start_time', new Date(Date.now() - 4 * 3600 * 1000).toISOString())
    .order('start_time')
    .limit(15);

  for (const g of games || []) {
    console.log(`\n[${g.league}] ${g.away_team_name} @ ${g.home_team_name} | src:${g.source}`);

    const { data: pricing } = await supabase
      .from('pricing_snapshots')
      .select('source_name, lowest_price, captured_at')
      .eq('game_id', g.id)
      .order('captured_at', { ascending: false });
    if (!pricing?.length) {
      console.log('  PRICING: ❌ none');
    } else {
      for (const p of pricing) console.log(`  PRICING: ${p.source_name} $${p.lowest_price} @ ${p.captured_at}`);
    }

    const { data: score } = await supabase
      .from('scores')
      .select('deal_score, price_score, experience_score, reasoning_summary')
      .eq('game_id', g.id)
      .single();
    if (!score) {
      console.log('  SCORE: ❌ none');
    } else {
      console.log(`  SCORE: deal=${score.deal_score} | price=${score.price_score} | exp=${score.experience_score}`);
      console.log(`  REASON: ${score.reasoning_summary}`);
    }
  }
}
main().catch(console.error);
