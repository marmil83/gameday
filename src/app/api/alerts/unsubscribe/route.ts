// GET  /api/alerts/unsubscribe?token=<uuid>  → renders confirmation page
// POST /api/alerts/unsubscribe?token=<uuid>  → RFC 8058 one-click endpoint
//                                              for Gmail/Yahoo
//
// Both methods do the same DB update — flip status to 'unsubscribed' —
// but POST returns 204 (silent ack for mail clients) while GET returns
// an HTML confirmation page (humans clicking from an email).

import { NextRequest } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

function landingPage(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — WorthGoing</title></head>
<body style="margin:0;padding:32px 16px;background:#0a0a0d;color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:460px;width:100%;background:#15151c;border:1px solid rgba(255,255,255,0.06);border-radius:20px;padding:36px 32px;text-align:center;">
    <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#fafafa;">WorthGoing</div>
    <div style="width:64px;height:4px;border-radius:2px;background:#9090a0;margin:24px auto 0;"></div>
    <h1 style="font-size:24px;font-weight:700;color:#fafafa;letter-spacing:-0.02em;margin:24px 0 12px;line-height:1.2;">${title}</h1>
    <p style="font-size:15px;color:#9090a0;line-height:1.5;margin:0 0 28px;">${message}</p>
    <a href="/" style="display:inline-block;background:#fafafa;color:#0a0a0d;font-weight:700;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:100px;">Back to games</a>
  </div>
</body></html>`;
}

async function unsubscribeByToken(token: string): Promise<'ok' | 'not-found'> {
  const supabase = createServiceClient();
  const { data: alert } = await supabase
    .from('price_alerts')
    .select('id')
    .eq('unsubscribe_token', token)
    .maybeSingle();
  if (!alert) return 'not-found';

  await supabase
    .from('price_alerts')
    .update({ status: 'unsubscribed' })
    .eq('id', alert.id);
  return 'ok';
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return htmlResponse(landingPage("Hmm, that link looks off.", "No unsubscribe token was provided."), 400);

  const result = await unsubscribeByToken(token);
  if (result === 'not-found') {
    return htmlResponse(landingPage("Already unsubscribed.", "We couldn't find an active alert at that link. You're good either way — we won't email you about this game."));
  }
  return htmlResponse(landingPage("Unsubscribed ✓", "Done. We won't email you about this game again."));
}

// RFC 8058 one-click POST. Gmail/Yahoo hit this directly when a user
// clicks the inbox "Unsubscribe" button. Spec says respond fast and
// silent (204 No Content).
export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) return new Response(null, { status: 400 });
  await unsubscribeByToken(token);
  return new Response(null, { status: 204 });
}
