import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const { data: teams } = await sb.from('teams').select('name, league, logo_url').not('logo_url', 'is', null).order('league');
  if (!teams) return;

  const broken: { name: string; league: string; logo_url: string }[] = [];
  for (const t of teams) {
    try {
      const res = await fetch(t.logo_url!, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      if (!res.ok) broken.push(t as any);
    } catch {
      broken.push(t as any);
    }
  }

  if (broken.length === 0) {
    console.log('✓ All logos working');
  } else {
    console.log(`\n⚠️  ${broken.length} broken logos:`);
    for (const t of broken) console.log(`  [${t.league}] ${t.name} — ${t.logo_url}`);
  }
}
main();
