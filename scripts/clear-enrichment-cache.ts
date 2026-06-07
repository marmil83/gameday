// Strip the input-hash sentinel from every upcoming game's insights.
//
// The enrichment pipeline embeds a fingerprint of its inputs as a fake
// "_h:abc123" entry in game_insights.context_flags. Skip-if-unchanged
// logic compares that fingerprint to the freshly-computed one and
// no-ops the Claude call when they match. After a prompt change, the
// cache is stale and we want the next pipeline run to re-enrich
// every game — easiest way is to delete the fingerprints.
//
// Idempotent — re-running it on a row whose hash was already stripped
// is a no-op. Doesn't touch verdict / why_worth_it / any visible text;
// it just invalidates the cache so the next pipeline tick rewrites
// those fields with the current prompt.
//
// Usage:
//   npx tsx scripts/clear-enrichment-cache.ts          # all upcoming games
//   npx tsx scripts/clear-enrichment-cache.ts --dry    # show count, don't write

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const HASH_PREFIX = '_h:';
const dryRun = process.argv.includes('--dry');

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Only touch games that are still scheduled and upcoming — re-enriching
  // a 3-week-old completed game is wasted tokens. The "is_home_game=true"
  // mirrors the public query filter; we don't enrich away rows anyway.
  const { data: games } = await sb
    .from('games')
    .select('id, start_time, home_team_name, game_insights(context_flags)')
    .eq('status', 'scheduled')
    .eq('is_home_game', true)
    .gte('start_time', new Date().toISOString());

  if (!games?.length) {
    console.log('No upcoming games found.');
    return;
  }

  let withHash = 0;
  let updated = 0;

  for (const g of games) {
    const insights = (g.game_insights as { context_flags: string[] | null }[] | null) ?? [];
    const flags = insights[0]?.context_flags;
    if (!flags?.some(f => typeof f === 'string' && f.startsWith(HASH_PREFIX))) continue;

    withHash++;
    if (dryRun) continue;

    const stripped = flags.filter(f => !(typeof f === 'string' && f.startsWith(HASH_PREFIX)));
    const { error } = await sb
      .from('game_insights')
      .update({ context_flags: stripped })
      .eq('game_id', g.id);

    if (error) {
      console.error(`✗ ${g.home_team_name} (${g.id}):`, error.message);
    } else {
      updated++;
    }
  }

  console.log(`\nScanned ${games.length} upcoming games — ${withHash} had a cached fingerprint.`);
  if (dryRun) {
    console.log(`Dry run: not modifying. Re-run without --dry to invalidate ${withHash} caches.`);
  } else {
    console.log(`✓ Cleared ${updated} fingerprints. Next pipeline run for each city will re-enrich them.`);
  }
}

main();
