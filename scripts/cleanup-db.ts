/**
 * DB Cleanup Script — runs daily via scheduled task
 * 1. Mark past scheduled games as completed (4-hour grace for in-progress)
 * 2. Delete phantom self-play games (away_team_name = home_team_name)
 * 3. Merge SeatGeek major-league home rows into ESPN equivalents
 *    (transfer pricing snapshots, delete SeatGeek dupe)
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAJOR_LEAGUES = ['NBA', 'NHL', 'MLB', 'NFL', 'MLS', 'NWSL', 'WNBA'];
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

async function markPastGamesCompleted() {
  console.log('[Cleanup] Marking past scheduled games as completed...');
  // 4-hour grace window — games that started recently may still be in progress
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const { error } = await sb
    .from('games')
    .update({ status: 'completed' })
    .eq('status', 'scheduled')
    .lt('start_time', cutoff);
  if (error) {
    console.error('  Error:', error.message);
  } else {
    const { count } = await sb
      .from('games')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'scheduled')
      .lt('start_time', cutoff);
    console.log(`  ✓ Done (${count ?? 0} remaining — within grace window or error)`);
  }
}

async function deletePhantomSelfPlayGames() {
  console.log('[Cleanup] Removing phantom self-play games (away = home)...');
  const { data: scheduled } = await sb
    .from('games')
    .select('id, home_team_name, away_team_name, source, start_time')
    .eq('status', 'scheduled');

  const phantoms = (scheduled ?? []).filter((g: any) => g.away_team_name === g.home_team_name);
  if (phantoms.length === 0) {
    console.log('  ✓ None found');
    return;
  }

  for (const g of phantoms) {
    // Delete all related rows before deleting the game
    await sb.from('pricing_snapshots').delete().eq('game_id', g.id);
    await sb.from('scores').delete().eq('game_id', g.id);
    await sb.from('game_insights').delete().eq('game_id', g.id);
    await sb.from('tags').delete().eq('game_id', g.id);
    await sb.from('promotions').delete().eq('game_id', g.id);
    await sb.from('games').delete().eq('id', g.id);
    console.log(`  ✓ Deleted: ${g.away_team_name} @ ${g.home_team_name} ${g.start_time.substring(0, 10)} [${g.source}]`);
  }
}

async function mergeOrphanedSeatGeekRows() {
  console.log('[Cleanup] Merging orphaned SeatGeek major-league rows into ESPN equivalents...');
  const { data: sgRows } = await sb
    .from('games')
    .select('id, home_team_name, away_team_name, league, start_time, city_id')
    .eq('source', 'seatgeek')
    .eq('is_home_game', true)
    .eq('status', 'scheduled')
    .in('league', MAJOR_LEAGUES);

  if (!sgRows || sgRows.length === 0) {
    console.log('  ✓ None found');
    return;
  }

  let merged = 0;
  let deleted = 0;
  let kept = 0;

  for (const sg of sgRows as any[]) {
    const sgTime = new Date(sg.start_time).getTime();

    // Look for an ESPN game for the same home team within ±12h
    const { data: espnMatches } = await sb
      .from('games')
      .select('id, away_team_name, start_time')
      .eq('source', 'espn')
      .eq('home_team_name', sg.home_team_name)
      .eq('city_id', sg.city_id)
      .eq('status', 'scheduled')
      .gte('start_time', new Date(sgTime - TWELVE_HOURS).toISOString())
      .lte('start_time', new Date(sgTime + TWELVE_HOURS).toISOString());

    if (espnMatches && espnMatches.length > 0) {
      const espn = (espnMatches as any[])[0];

      // Transfer any pricing from SeatGeek row to ESPN row
      const { data: sgPricing } = await sb
        .from('pricing_snapshots')
        .select('id')
        .eq('game_id', sg.id);

      if (sgPricing && sgPricing.length > 0) {
        await sb.from('pricing_snapshots')
          .update({ game_id: espn.id })
          .eq('game_id', sg.id);
        merged += sgPricing.length;
      }

      // Delete the SeatGeek dupe
      await sb.from('scores').delete().eq('game_id', sg.id);
      await sb.from('game_insights').delete().eq('game_id', sg.id);
      await sb.from('tags').delete().eq('game_id', sg.id);
      await sb.from('promotions').delete().eq('game_id', sg.id);
      await sb.from('games').delete().eq('id', sg.id);
      deleted++;
    } else {
      kept++; // No ESPN row yet — leave it alone
    }
  }

  console.log(`  ✓ Merged ${merged} pricing rows, deleted ${deleted} SeatGeek dupes, kept ${kept} (no ESPN match yet)`);
}

async function main() {
  console.log('=== Foamfinger DB Cleanup ===\n');
  await markPastGamesCompleted();
  await deletePhantomSelfPlayGames();
  await mergeOrphanedSeatGeekRows();

  const { count } = await sb
    .from('games')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'scheduled')
    .eq('is_home_game', true)
    .gte('start_time', new Date().toISOString());
  console.log(`\nDone. ${count} upcoming home games active.`);
}

main();
