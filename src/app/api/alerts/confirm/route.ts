// GET /api/alerts/confirm?token=<uuid>
//
// Flips a pending alert to active. Returns a small standalone HTML page
// (not a JSON response — visitors arrive here via the email link).

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function landingPage(title: string, message: string, kind: 'ok' | 'error' = 'ok'): string {
  const accent = kind === 'ok' ? '#34c759' : '#ff453a';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — WorthGoing</title></head>
<body style="margin:0;padding:32px 16px;background:#0a0a0d;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:460px;width:100%;background:#15151c;border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:36px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#fafafa;">WorthGoing</div>
    <div style="width:64px;height:4px;border-radius:2px;background:${accent};margin:24px auto 0;"></div>
    <h1 style="font-size:24px;font-weight:700;color:#fafafa;letter-spacing:-0.02em;margin:24px 0 12px;line-height:1.2;">${title}</h1>
    <p style="font-size:15px;color:#9090a0;line-height:1.5;margin:0 0 28px;">${message}</p>
    <a href="/" style="display:inline-block;background:#fafafa;color:#0a0a0d;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:100px;">Back to games</a>
  </div>
</body></html>`;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return htmlResponse(landingPage("Hmm, that link looks off.", "No confirmation token was found. Try clicking the link from your email again.", 'error'), 400);
  }

  const supabase = createServiceClient();

  const { data: alert } = await supabase
    .from('price_alerts')
    .select('id, status')
    .eq('confirm_token', token)
    .maybeSingle();

  if (!alert) {
    return htmlResponse(landingPage("This link has expired.", "We couldn't find an alert matching this confirmation link. Try signing up again.", 'error'), 404);
  }

  if (alert.status === 'unsubscribed') {
    return htmlResponse(landingPage("This alert was unsubscribed.", "You unsubscribed earlier. Sign up again from the game's card if you want to start watching."), 200);
  }

  if (alert.status === 'active') {
    return htmlResponse(landingPage("Already watching ✓", "This alert is already active. We'll email you when the price drops."), 200);
  }

  await supabase
    .from('price_alerts')
    .update({ status: 'active', confirmed_at: new Date().toISOString() })
    .eq('id', alert.id);

  return htmlResponse(landingPage("You're watching ✓", "We'll email you when ticket prices drop. Unsubscribe anytime from any alert email."));
}
