// GET /api/cron/price-drop-alerts
//
// Runs ~hourly after the pricing scrape lands new snapshots. For each
// active alert:
//   1. Fetch the cheapest current snapshot for game_id
//   2. Compare against baseline_price (or last_notified_price if newer)
//   3. If the drop crosses threshold AND last notification > 24h ago,
//      send the drop email
//   4. Update last_notified_at + last_notified_price so we don't spam
//      and so a staircase down (5% → 5% → 5%) fires repeatedly
//
// Idempotent — running twice in a row does nothing the second time
// because the price hasn't changed since the first run updated the
// snapshot baseline.

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail, priceDropEmail, SITE_URL } from '@/lib/email/brevo';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Mirror the GameCard marquee logic so the email matchup title matches
// what the visitor sees on the card.
function matchupTitle(game: { home_team_name: string; away_team_name: string; league: string }): string {
  const isWC = game.league === 'FIFA-WC';
  const marquee = isWC ? game.home_team_name : game.away_team_name;
  const opponent = isWC ? game.away_team_name : game.home_team_name;
  return isWC ? `${marquee} vs ${opponent}` : `${marquee} at ${opponent}`;
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  // Auth: same pattern as the pipeline routes — Authorization header OR
  // ?secret=... (Vercel cron uses the env var via Authorization). Skip
  // the check in dev so curl-testing is friction-free.
  const pipelineSecret = process.env.PIPELINE_SECRET;
  if (pipelineSecret) {
    const auth = req.headers.get('authorization') || '';
    const querySecret = req.nextUrl.searchParams.get('secret');
    const ok = auth === `Bearer ${pipelineSecret}` || querySecret === pipelineSecret;
    if (!ok) return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createServiceClient();

  // Pull all active alerts. Even at 100k subscribers this is a single
  // table scan + cheap join — no need for paging yet.
  const { data: alerts, error } = await supabase
    .from('price_alerts')
    .select(`
      id, email, game_id, threshold_pct,
      baseline_price, last_notified_price, last_notified_at,
      unsubscribe_token
    `)
    .eq('status', 'active');

  if (error || !alerts) {
    return NextResponse.json({ error: error?.message ?? 'load failed' }, { status: 500 });
  }

  let scanned = 0;
  let fired = 0;
  let skippedDebounced = 0;
  let skippedNoDrop = 0;
  let skippedNoPrice = 0;
  let baselineSeeded = 0;

  // Group alerts by game so we do ONE snapshot lookup per unique game
  // even if 100 visitors are watching the same game.
  const byGame = new Map<string, typeof alerts>();
  for (const a of alerts) {
    const list = byGame.get(a.game_id) ?? [];
    list.push(a);
    byGame.set(a.game_id, list);
  }

  for (const [gameId, gameAlerts] of byGame) {
    // Cheapest current price across all sources for this game.
    const { data: priceRow } = await supabase
      .from('pricing_snapshots')
      .select('lowest_price')
      .eq('game_id', gameId)
      .not('lowest_price', 'is', null)
      .order('lowest_price', { ascending: true })
      .limit(1)
      .maybeSingle();

    const currentPrice = (priceRow?.lowest_price as number | null) ?? null;

    // Fetch the matching game (for the email body) — one row, all alerts
    // for this game share it.
    const { data: game } = await supabase
      .from('games')
      .select('home_team_name, away_team_name, league')
      .eq('id', gameId)
      .maybeSingle();
    if (!game) continue;
    const title = matchupTitle(game);

    for (const a of gameAlerts) {
      scanned++;

      if (currentPrice == null) { skippedNoPrice++; continue; }

      // Seed baseline on first observed price — happens when a visitor
      // subscribed to a no-price game (typical for newly-seeded WC matches
      // before SeatGeek surfaces prices).
      if (a.baseline_price == null) {
        await supabase
          .from('price_alerts')
          .update({ baseline_price: currentPrice })
          .eq('id', a.id);
        baselineSeeded++;
        continue;
      }

      // Compare against last_notified_price if present (so a staircase
      // down keeps firing), otherwise baseline.
      const referencePrice = (a.last_notified_price as number | null) ?? Number(a.baseline_price);
      if (currentPrice >= referencePrice) { skippedNoDrop++; continue; }

      const dropPct = ((referencePrice - currentPrice) / referencePrice) * 100;
      if (dropPct < Number(a.threshold_pct)) { skippedNoDrop++; continue; }

      // Debounce — never fire more than once per 24h per alert.
      if (a.last_notified_at) {
        const lastMs = new Date(a.last_notified_at).getTime();
        if (Date.now() - lastMs < TWENTY_FOUR_HOURS_MS) { skippedDebounced++; continue; }
      }

      const { subject, html, text } = priceDropEmail({
        matchupTitle: title,
        newPrice: Math.round(currentPrice),
        baselinePrice: Math.round(Number(referencePrice)),
        dropPct: Math.round(dropPct),
        gameUrl: `${SITE_URL}/?game=${gameId}`,
        unsubscribeUrl: `${SITE_URL}/api/alerts/unsubscribe?token=${a.unsubscribe_token}`,
      });

      const result = await sendEmail({
        to: a.email,
        subject,
        html,
        text,
        unsubscribeUrl: `${SITE_URL}/api/alerts/unsubscribe?token=${a.unsubscribe_token}`,
      });

      if (!result.ok) {
        console.error('[price-drop-alerts] Brevo failed:', result.error, { alertId: a.id });
        continue;
      }

      await supabase
        .from('price_alerts')
        .update({
          last_notified_at: new Date().toISOString(),
          last_notified_price: currentPrice,
        })
        .eq('id', a.id);

      fired++;
    }
  }

  return NextResponse.json({
    scanned,
    fired,
    skippedDebounced,
    skippedNoDrop,
    skippedNoPrice,
    baselineSeeded,
  });
}
