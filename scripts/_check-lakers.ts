import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  // Get the actual Thunder game IDs
  const { data: games } = await sb
    .from('games')
    .select('id, home_team_name, away_team_name, start_time')
    .ilike('away_team_name', '%Thunder%')
    .order('start_time');

  for (const g of games || []) {
    const { data: insights } = await sb.from('game_insights').select('*').eq('game_id', g.id).single();
    console.log(`\n=== ${g.away_team_name} @ ${g.home_team_name} (${g.start_time.substring(0,10)}) id=${g.id} ===`);
    console.log('Has insights:', !!insights);
    if (insights) {
      console.log('context_flags:', (insights as any).context_flags);
      console.log('why_worth_it:', (insights as any).why_worth_it);
    }
  }

  // Check Lakers and Thunder in teams table
  const { data: lakers } = await sb.from('teams').select('name, wins, losses, streak').ilike('name', '%Lakers%').single();
  const { data: thunder } = await sb.from('teams').select('name, wins, losses, streak').ilike('name', '%Thunder%').single();
  console.log('\nLakers:', lakers);
  console.log('Thunder:', thunder);
}
main();
