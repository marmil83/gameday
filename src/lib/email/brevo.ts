// Brevo transactional email wrapper.
//
// Brevo's free tier ships 300 emails/day (~9k/month) which comfortably
// covers price-drop alerts at our launch volume. We talk to the REST API
// directly to avoid pulling in @getbrevo/brevo (~MB of SDK code) for what
// is one POST endpoint.
//
// Required env:
//   BREVO_API_KEY             — from app.brevo.com/settings/keys/api
//   EMAIL_FROM_ADDRESS        — must match a verified sender in Brevo,
//                                e.g. "alerts@worthgoing.to"
// Optional env:
//   EMAIL_FROM_NAME           — defaults to "WorthGoing"
//   NEXT_PUBLIC_SITE_URL      — used for unsubscribe + confirm links,
//                                defaults to "https://www.worthgoing.to"

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') || 'https://www.worthgoing.to';

const FROM_NAME = process.env.EMAIL_FROM_NAME || 'WorthGoing';
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'alerts@worthgoing.to';

interface SendOpts {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * If provided, sends RFC-8058 one-click unsubscribe headers — required
   * by Gmail/Yahoo Feb-2024 sender rules at any meaningful volume.
   */
  unsubscribeUrl?: string;
}

export async function sendEmail({ to, subject, html, text, unsubscribeUrl }: SendOpts): Promise<{
  ok: boolean;
  messageId?: string;
  error?: string;
}> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'BREVO_API_KEY not configured' };
  }

  const body: Record<string, unknown> = {
    sender: { name: FROM_NAME, email: FROM_ADDRESS },
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: text,
  };

  if (unsubscribeUrl) {
    body.headers = {
      // RFC 8058 — one-click POST unsubscribe (Gmail/Yahoo recognize)
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: `Brevo ${res.status}: ${errText.slice(0, 200)}` };
    }
    const data = await res.json();
    return { ok: true, messageId: data?.messageId };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// ─── HTML escape helper ────────────────────────────────────────────────
// Tiny replacement for a full HTML escaper. Game/team names occasionally
// contain '&' (e.g. "Erie SeaWolves & friends" hypothetical) so we must
// escape user-facing strings before slotting them into HTML templates.

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Email templates ──────────────────────────────────────────────────
// Inline-styled HTML for maximum Outlook/Gmail-app compatibility.
// Keep it brand-aligned (dark bg, accent green, Space Grotesk-ish via
// system stack) but defensive — many clients strip web fonts and
// background images, so we use system fonts + solid backgrounds only.

const BRAND_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';

interface ConfirmCtx {
  matchupTitle: string;     // e.g. "New York Yankees vs Boston Red Sox"
  thresholdLabel: string;   // e.g. "any drop" or "5% or more"
  confirmUrl: string;
}

export function confirmEmail(ctx: ConfirmCtx): { subject: string; html: string; text: string } {
  const subject = `Confirm your price-drop alert for ${ctx.matchupTitle}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0a0a0d;font-family:${BRAND_FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0d;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#15151c;border:1px solid rgba(255,255,255,0.06);border-radius:20px;">
        <tr><td style="padding:32px;">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#fafafa;">WorthGoing</div>
          <div style="font-size:13px;color:#7a7a85;margin-top:4px;">Know Before You Go</div>

          <h1 style="font-size:24px;font-weight:700;color:#fafafa;letter-spacing:-0.02em;margin:28px 0 12px;line-height:1.2;">One last step — confirm your alert</h1>
          <p style="font-size:15px;color:#9090a0;line-height:1.5;margin:0 0 24px;">
            You asked us to watch ticket prices for <strong style="color:#fafafa;">${esc(ctx.matchupTitle)}</strong> and ping you on <strong style="color:#fafafa;">${esc(ctx.thresholdLabel)}</strong>. Confirm below and we'll start watching.
          </p>

          <a href="${esc(ctx.confirmUrl)}" style="display:inline-block;background:#34c759;color:#0a0a0d;font-weight:700;font-size:15px;text-decoration:none;padding:14px 24px;border-radius:100px;">Confirm alert</a>

          <p style="font-size:12px;color:#52525b;line-height:1.5;margin:32px 0 0;">
            Didn't sign up? Ignore this email — we'll never email you again from this address without a confirmation.
          </p>
        </td></tr>
      </table>
      <div style="font-size:11px;color:#52525b;margin-top:16px;">${SITE_URL.replace(/^https?:\/\//, '')}</div>
    </td></tr>
  </table>
</body></html>`;
  const text = `Confirm your WorthGoing price-drop alert for ${ctx.matchupTitle}.

We'll ping you on ${ctx.thresholdLabel}.

Confirm: ${ctx.confirmUrl}

Didn't sign up? Ignore this email.`;
  return { subject, html, text };
}

interface PriceDropCtx {
  matchupTitle: string;
  newPrice: number;
  baselinePrice: number;
  dropPct: number;
  gameUrl: string;
  unsubscribeUrl: string;
}

export function priceDropEmail(ctx: PriceDropCtx): { subject: string; html: string; text: string } {
  const subject = `${ctx.matchupTitle} dropped to $${ctx.newPrice} (-${ctx.dropPct}%)`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#0a0a0d;font-family:${BRAND_FONT};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0d;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#15151c;border:1px solid rgba(255,255,255,0.06);border-radius:20px;">
        <tr><td style="padding:32px;">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#fafafa;">WorthGoing</div>
          <div style="font-size:13px;color:#7a7a85;margin-top:4px;">Price drop alert</div>

          <h1 style="font-size:26px;font-weight:700;color:#fafafa;letter-spacing:-0.025em;margin:28px 0 8px;line-height:1.15;">${esc(ctx.matchupTitle)}</h1>
          <div style="font-size:14px;color:#9090a0;margin:0 0 24px;">Tickets just dropped.</div>

          <div style="background:#1f1f28;border-radius:14px;padding:20px 22px;margin-bottom:24px;">
            <div style="font-size:42px;font-weight:700;color:#34c759;letter-spacing:-0.03em;line-height:1;">$${ctx.newPrice}</div>
            <div style="font-size:13px;color:#9090a0;margin-top:6px;">
              was <span style="text-decoration:line-through;">$${ctx.baselinePrice}</span> &middot; ${ctx.dropPct}% off
            </div>
          </div>

          <a href="${esc(ctx.gameUrl)}" style="display:inline-block;background:#fafafa;color:#0a0a0d;font-weight:700;font-size:15px;text-decoration:none;padding:14px 24px;border-radius:100px;">See tickets</a>

          <p style="font-size:11px;color:#52525b;line-height:1.6;margin:36px 0 0;border-top:1px solid rgba(255,255,255,0.06);padding-top:16px;">
            Prices on the marketplace change every few minutes — this one may not last.
            <br><br>
            Don't want these anymore? <a href="${esc(ctx.unsubscribeUrl)}" style="color:#9090a0;text-decoration:underline;">Unsubscribe in one click</a>.
          </p>
        </td></tr>
      </table>
      <div style="font-size:11px;color:#52525b;margin-top:16px;">${SITE_URL.replace(/^https?:\/\//, '')}</div>
    </td></tr>
  </table>
</body></html>`;
  const text = `${ctx.matchupTitle} dropped to $${ctx.newPrice} (was $${ctx.baselinePrice}, ${ctx.dropPct}% off).

See tickets: ${ctx.gameUrl}

Unsubscribe: ${ctx.unsubscribeUrl}`;
  return { subject, html, text };
}

// Human-readable threshold label for the confirmation email.
export function thresholdLabel(thresholdPct: number): string {
  if (thresholdPct <= 0) return 'any price drop';
  return `a drop of ${thresholdPct}% or more`;
}
