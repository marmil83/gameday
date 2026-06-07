'use client';

import { useState, useEffect } from 'react';

interface AlertModalProps {
  gameId: string;
  matchupTitle: string;          // "Yankees at Red Sox" — for the modal headline
  onClose: () => void;
  onSubscribed: () => void;       // fires AFTER successful create — parent flips the button to "Watching"
}

const THRESHOLDS: { label: string; value: number }[] = [
  { label: 'Any price drop', value: 0 },
  { label: '5% or more',     value: 5 },
  { label: '10% or more',    value: 10 },
  { label: '20% or more',    value: 20 },
];

export default function AlertModal({ gameId, matchupTitle, onClose, onSubscribed }: AlertModalProps) {
  const [email, setEmail] = useState('');
  const [threshold, setThreshold] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // True when the server told us this email was already-confirmed and
  // we activated the alert without sending a confirm link. Drives the
  // success copy ("You're watching ✓" vs "Check your email").
  const [autoActivated, setAutoActivated] = useState(false);
  // Whether we've prefilled the email from localStorage — controls the
  // "as <email> · change" line vs. the raw email input.
  const [emailLocked, setEmailLocked] = useState(false);

  // Prefill the saved email so returning visitors don't retype it. The
  // backend also short-circuits to instant-activate for any email that's
  // already confirmed an alert, so combined with this the second-time
  // flow is: open modal → tap threshold (or accept default) → submit →
  // done.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = window.localStorage.getItem('wg_email');
      if (saved) {
        setEmail(saved);
        setEmailLocked(true);
      }
    } catch { /* private mode etc. */ }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const finalEmail = email.trim().toLowerCase();
      const res = await fetch('/api/alerts/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId, email: finalEmail, thresholdPct: threshold }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Could not save your alert. Try again?');
      }
      const data = await res.json().catch(() => ({}));
      // Save the email for future signups so the visitor never retypes.
      try { window.localStorage.setItem('wg_email', finalEmail); } catch {}
      onSubscribed();
      setAutoActivated(!!data.autoActivated);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-0 sm:px-5"
      onClick={e => {
        // Tap on the dim backdrop closes — but only if it wasn't a tap
        // inside the sheet (we stopPropagation there).
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl px-7 pt-3 sm:pt-6 overflow-y-auto overscroll-contain"
        // maxHeight: 100dvh = dynamic viewport (iOS Safari shrinks this
        // when the keyboard opens, so the modal stays inside the visible
        // area instead of clipping at the top). overflow-y-auto turns the
        // sheet body into a scrollable region when the form + keyboard
        // exceeds the available height. overscroll-contain prevents
        // pull-to-refresh on iOS from triggering when the user drags.
        // Bottom padding combines a normal 28px base + the device's safe-
        // area inset + an extra 24px buffer for the iOS Safari URL pill
        // that floats over the viewport bottom.
        style={{
          background: '#15151c',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.6)',
          maxHeight: '100dvh',
          paddingBottom: 'calc(28px + env(safe-area-inset-bottom, 0px) + 24px)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* iOS-style sheet drag handle — visual affordance that this is
            a bottom sheet you can dismiss. Mobile only. */}
        <div
          className="sm:hidden mx-auto mb-4 h-1 w-10 rounded-full"
          style={{ background: 'rgba(255,255,255,0.18)' }}
          aria-hidden="true"
        />
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2
              className="text-2xl tracking-tight"
              style={{ color: '#fafafa', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}
            >
              {done
                ? (autoActivated ? "You're watching ✓" : "Check your email")
                : "Get price-drop alerts"}
            </h2>
            {/* Matchup chip — visible in every state so visitors can
                confirm WHICH game they're signing up for / confirming.
                Lives below the headline as a chip (not in the body copy)
                so a long team name never inflates the description to 3
                lines, which collapsed the modal earlier. */}
            <div
              className="inline-flex items-center mt-2 px-2.5 py-1 rounded-md text-xs font-medium max-w-full"
              style={{
                background: '#1f1f28',
                color: '#fafafa',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <span className="truncate">{matchupTitle}</span>
            </div>
            <p className="text-sm mt-2.5" style={{ color: '#9090a0' }}>
              {done
                ? (autoActivated
                    ? `We'll email you when tickets drop.`
                    : `Sent to ${email}. Click the confirm link to start watching.`)
                : `We'll email you when tickets drop. Unsubscribe anytime.`}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 -mt-1 -mr-1 w-9 h-9 rounded-full flex items-center justify-center transition-colors"
            style={{ color: '#9090a0' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 6l12 12M6 18L18 6" />
            </svg>
          </button>
        </div>

        {!done ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#7a7a85' }}>Email</label>
              {emailLocked ? (
                // Returning visitor — show the saved email as a chip with a
                // "change" button instead of forcing them to retype. Tapping
                // change unlocks the input for editing (e.g. they want to
                // route alerts for this game to a different inbox).
                <div
                  className="flex items-center justify-between gap-2 px-4 py-3 rounded-2xl text-sm"
                  style={{ background: '#1f1f28', color: '#fafafa', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <span className="truncate">{email}</span>
                  <button
                    type="button"
                    onClick={() => setEmailLocked(false)}
                    className="text-xs font-semibold underline shrink-0"
                    style={{ color: '#9090a0' }}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <input
                  type="email"
                  required
                  // Intentionally NOT autoFocus — popping the iOS
                  // keyboard the instant the modal opens collapsed the
                  // available height, clipping the headline + CTA. The
                  // visitor sees the whole form first, taps when ready.
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-4 py-3 rounded-2xl focus:outline-none"
                  // fontSize MUST be ≥16px on iOS Safari or focusing the
                  // field triggers an auto-zoom that scales the whole page.
                  // text-sm (14px) was the culprit; 16px inline keeps the
                  // intent obvious without touching the rest of the design.
                  style={{
                    background: '#1f1f28',
                    color: '#fafafa',
                    border: '1px solid rgba(255,255,255,0.08)',
                    fontSize: '16px',
                  }}
                />
              )}
            </div>

            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#7a7a85' }}>Notify me on</label>
              <div className="flex flex-wrap gap-1.5">
                {THRESHOLDS.map(t => {
                  const active = threshold === t.value;
                  return (
                    <button
                      type="button"
                      key={t.value}
                      onClick={() => setThreshold(t.value)}
                      className="px-3.5 py-1.5 rounded-full text-sm font-medium transition-all duration-150"
                      style={active
                        ? { background: '#fafafa', color: '#0a0a0d' }
                        : { background: '#1f1f28', color: '#fafafa', border: '1px solid rgba(255,255,255,0.08)' }
                      }
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {error && (
              <div className="text-xs px-3 py-2 rounded-xl" style={{ background: 'rgba(255,69,58,0.1)', color: '#ff453a', border: '1px solid rgba(255,69,58,0.2)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !email}
              className="w-full mt-2 py-3.5 px-5 font-semibold text-sm rounded-full transition-all duration-150 active:scale-[0.98] disabled:opacity-50"
              style={{ background: '#34c759', color: '#0a0a0d' }}
            >
              {submitting ? 'Saving…' : 'Watch this game'}
            </button>

            <p className="text-[11px] leading-relaxed text-center" style={{ color: '#52525b' }}>
              By signing up you agree to receive transactional emails about this game. We never sell your data.
              {' '}<a href="/privacy" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#7a7a85' }}>Privacy</a>
              {' · '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#7a7a85' }}>Terms</a>
            </p>
          </form>
        ) : (
          <button
            onClick={onClose}
            className="w-full mt-6 py-3.5 px-5 font-semibold text-sm rounded-full transition-all duration-150 active:scale-[0.98]"
            style={{ background: '#fafafa', color: '#0a0a0d' }}
          >
            Got it
          </button>
        )}
      </div>
    </div>
  );
}
