'use client';

import { useState } from 'react';

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/alerts/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameId, email: email.trim().toLowerCase(), thresholdPct: threshold }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Could not save your alert. Try again?');
      }
      // Tell the parent so the bell flips to "watching" persistently.
      onSubscribed();
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm px-0 sm:px-5">
      <div
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl px-7 pt-6 pb-7"
        style={{
          background: '#15151c',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.6)',
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2
              className="text-2xl tracking-tight"
              style={{ color: '#fafafa', fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.15 }}
            >
              {done ? "Check your email" : "Get price-drop alerts"}
            </h2>
            <p className="text-sm mt-1.5" style={{ color: '#9090a0' }}>
              {done
                ? `We sent a confirmation to ${email}. Click the link to start watching ${matchupTitle}.`
                : `We'll email you when ${matchupTitle} tickets drop. Unsubscribe anytime.`}
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
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-2xl text-sm focus:outline-none"
                style={{
                  background: '#1f1f28',
                  color: '#fafafa',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              />
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
