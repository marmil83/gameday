// One-off (re-runnable) backfill for Ticketmaster artist IDs.
//
// Ticketmaster's deep-link URL for a team is
//   /<team-slug>-tickets/artist/<artist_id>
// — the artist_id is opaque, per team, and not surfaced by any public API
// without a paid key. But their search results page (/search?q=<team>)
// is plain HTML with anchor tags of exactly that form, so we can scrape
// the search HTML once per team and cache the discovered ID on
// teams.external_ids.ticketmaster_artist_id. GameCard reads it from
// there at render time.
//
// Idempotent: skips teams that already have an ID cached. Re-runnable
// if a team migrates or we add new ones.
//
// Usage: npx tsx scripts/backfill-ticketmaster-ids.ts

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function discoverArtistId(teamName: string): Promise<string | null> {
  const url = `https://www.ticketmaster.com/search?q=${encodeURIComponent(teamName)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // First /<slug>-tickets/artist/<digits> match — the search result page
    // ranks the team itself at the top, so the first match is reliably right.
    const m = html.match(/href="\/[a-z0-9-]+-tickets\/artist\/(\d+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function main() {
  const { data: teams, error } = await supabase
    .from('teams')
    .select('id, name, external_ids')
    .eq('league_level', 'major');
  if (error || !teams) {
    console.error('Failed to fetch teams:', error?.message);
    process.exit(1);
  }
  console.log(`Backfilling Ticketmaster artist IDs for ${teams.length} major-league teams\n`);

  let done = 0, skipped = 0, missed = 0;
  for (const team of teams) {
    const existing = (team.external_ids as Record<string, unknown> | null)?.ticketmaster_artist_id;
    if (existing) {
      console.log(`  ~ ${team.name}: already has ID ${existing}`);
      skipped++;
      continue;
    }
    const id = await discoverArtistId(team.name);
    if (!id) {
      console.log(`  ✗ ${team.name}: no artist match on Ticketmaster`);
      missed++;
      // Polite delay even on misses
      await new Promise(r => setTimeout(r, 600));
      continue;
    }
    const newExternalIds = { ...((team.external_ids as Record<string, unknown> | null) || {}), ticketmaster_artist_id: id };
    const { error: upErr } = await supabase.from('teams').update({ external_ids: newExternalIds }).eq('id', team.id);
    if (upErr) {
      console.log(`  ✗ ${team.name}: DB update failed — ${upErr.message}`);
    } else {
      console.log(`  ✓ ${team.name}: ${id}`);
      done++;
    }
    // Avoid hammering Ticketmaster search
    await new Promise(r => setTimeout(r, 600));
  }
  console.log(`\nDone. ${done} backfilled, ${skipped} already cached, ${missed} not found on TM.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
