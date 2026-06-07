// POST /api/alerts/create
//
// Body: { gameId: string, email: string, thresholdPct?: number }
//
// Creates a pending price_alerts row (or reuses an existing pending one
// for the same email+game), seeds the baseline_price from the latest
// pricing snapshot, and sends a confirmation email. Returns 200 either
// way the response is identical — we don't reveal whether an email is
// already subscribed (mild enum-attack hardening).

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { sendEmail, confirmEmail, thresholdLabel, SITE_URL } from '@/lib/email/brevo';

export const runtime = 'nodejs';

const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

export async function POST(req: NextRequest) {
  let body: { gameId?: unknown; email?: unknown; thresholdPct?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const thresholdPctRaw = typeof body.thresholdPct === 'number' ? body.thresholdPct : 0;
  const thresholdPct = Math.max(0, Math.min(50, thresholdPctRaw));

  if (!gameId || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Email and gameId required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Verify the game exists and pull the matchup label + city for the
  // confirm email. Light validation — we don't gate by published/hidden
  // here because an admin might want alerts on a hidden game.
  const { data: game } = await supabase
    .from('games')
    .select('id, home_team_name, away_team_name, league')
    .eq('id', gameId)
    .maybeSingle();

  if (!game) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  // Marquee = away_team_name for normal games; for FIFA-WC the seed put
  // the marquee in home_team_name (see GameCard render). Mirror that here.
  const isWC = game.league === 'FIFA-WC';
  const marquee = isWC ? game.home_team_name : game.away_team_name;
  const opponent = isWC ? game.away_team_name : game.home_team_name;
  const matchupTitle = isWC ? `${marquee} vs ${opponent}` : `${marquee} at ${opponent}`;

  // Cheapest current price across all sources — used as baseline so the
  // first drop detected is a real drop. Null is fine; the cron sets it
  // on first observed price.
  const { data: snapshot } = await supabase
    .from('pricing_snapshots')
    .select('lowest_price')
    .eq('game_id', gameId)
    .not('lowest_price', 'is', null)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const baselinePrice = (snapshot?.lowest_price as number | null) ?? null;

  // Upsert: reuse the existing pending row for this (email, game) to
  // re-send the confirm if the visitor never confirmed. Active rows hit
  // the unique partial index — we surface them as "already watching"
  // without revealing whether the address is on file.
  const { data: existing } = await supabase
    .from('price_alerts')
    .select('id, status, confirm_token')
    .eq('email', email)
    .eq('game_id', gameId)
    .in('status', ['pending', 'active'])
    .maybeSingle();

  let alertId: string;
  let confirmToken: string;

  if (existing?.status === 'active') {
    // Don't expose this — just behave like a successful re-signup.
    return NextResponse.json({ ok: true, alreadyConfirmed: true });
  } else if (existing?.status === 'pending') {
    alertId = existing.id;
    confirmToken = existing.confirm_token as string;
    await supabase
      .from('price_alerts')
      .update({ threshold_pct: thresholdPct, baseline_price: baselinePrice })
      .eq('id', alertId);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('price_alerts')
      .insert({
        game_id: gameId,
        email,
        threshold_pct: thresholdPct,
        baseline_price: baselinePrice,
        source: 'card-button',
      })
      .select('id, confirm_token')
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json({ error: 'Could not create alert' }, { status: 500 });
    }
    alertId = inserted.id;
    confirmToken = inserted.confirm_token as string;
  }

  const confirmUrl = `${SITE_URL}/api/alerts/confirm?token=${confirmToken}`;
  const { subject, html, text } = confirmEmail({
    matchupTitle,
    thresholdLabel: thresholdLabel(thresholdPct),
    confirmUrl,
  });

  const result = await sendEmail({ to: email, subject, html, text });
  if (!result.ok) {
    // Don't leak the failure to the visitor — they'd just retry and
    // create duplicate pendings. Log server-side; the row persists and
    // can be retried by an admin tool later.
    console.error('[alerts/create] Brevo send failed:', result.error, { alertId });
  }

  return NextResponse.json({ ok: true });
}
