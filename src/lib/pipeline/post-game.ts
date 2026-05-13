// Post-game refresh: when a playoff (or any series) game completes, the
// copy on dependent upcoming games in the same series goes stale —
// "could become a closeout if X wins tonight" should immediately resolve
// to "X faces elimination" once we know the outcome. This helper runs as
// part of every pipeline cron (full + lightweight refresh-pricing), so
// the maximum staleness for dependent-game copy is ~4 hours after a
// game ends, not the ~12-hour window of the full pipeline alone.
//
// Two-step process:
//   1. Mark games whose start_time + 4h grace has passed as 'completed'
//   2. For each newly-completed game, find scheduled games between the
//      same two teams in the next 14 days and re-enrich them
//
// Idempotent: if no games just completed (typical case), no AI calls.

import type { SupabaseClient } from '@supabase/supabase-js';

interface PostGameResult {
  marked_completed: number;
  dependents_refreshed: number;
  errors: string[];
}

export async function markCompletedAndRefreshDependents(
  supabase: SupabaseClient,
  enrichSingleGame: (gameId: string, force?: boolean) => Promise<void>,
): Promise<PostGameResult> {
  const errors: string[] = [];
  const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

  // Step 1: select games about to be marked completed BEFORE updating, so
  // we know which ones just transitioned (UPDATE doesn't return rows).
  const { data: justCompleted, error: selErr } = await supabase
    .from('games')
    .select('id, home_team_name, away_team_name, league, start_time, is_home_game')
    .eq('status', 'scheduled')
    .lt('start_time', cutoff);
  if (selErr) {
    errors.push(`Failed to select past games: ${selErr.message}`);
    return { marked_completed: 0, dependents_refreshed: 0, errors };
  }

  // Step 2: mark them completed
  if (justCompleted && justCompleted.length > 0) {
    const { error: updErr } = await supabase
      .from('games')
      .update({ status: 'completed' })
      .eq('status', 'scheduled')
      .lt('start_time', cutoff);
    if (updErr) errors.push(`Failed to mark games completed: ${updErr.message}`);
  }

  // Step 3: for each newly-completed game, find dependent upcoming games
  // (same matchup, scheduled, within 14 days after). Deduplicate IDs
  // because a single team playing back-to-back-to-back creates overlap.
  const dependentIds = new Set<string>();
  for (const c of justCompleted ?? []) {
    if (!c.home_team_name || !c.away_team_name || c.away_team_name === 'TBD') continue;
    const twoWeeksAhead = new Date(new Date(c.start_time).getTime() + 14 * 24 * 3600_000).toISOString();
    const { data: deps, error: depErr } = await supabase
      .from('games')
      .select('id')
      .or(
        `and(home_team_name.eq.${c.home_team_name},away_team_name.eq.${c.away_team_name}),` +
        `and(home_team_name.eq.${c.away_team_name},away_team_name.eq.${c.home_team_name})`
      )
      .eq('league', c.league)
      .eq('status', 'scheduled')
      .gt('start_time', c.start_time)
      .lte('start_time', twoWeeksAhead);
    if (depErr) {
      errors.push(`Failed to find dependents for ${c.id}: ${depErr.message}`);
      continue;
    }
    for (const d of deps ?? []) dependentIds.add(d.id);
  }

  // Step 4: re-enrich each dependent game. Each enrichment calls Claude
  // (~1.5k output tokens) — fine when only a handful of games qualify.
  let refreshed = 0;
  for (const id of dependentIds) {
    try {
      // Force: post-game dependents must re-enrich even if their input
      // hash would otherwise look unchanged. The thing that changed is
      // OUR knowledge — the prior game just resolved, so the verdict copy
      // for this game needs to be rewritten to reflect the new series state.
      await enrichSingleGame(id, true);
      refreshed++;
    } catch (e) {
      errors.push(`Failed to re-enrich ${id}: ${(e as Error).message}`);
    }
  }

  return {
    marked_completed: justCompleted?.length ?? 0,
    dependents_refreshed: refreshed,
    errors,
  };
}
