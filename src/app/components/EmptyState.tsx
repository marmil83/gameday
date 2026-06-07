'use client';

import { useMemo } from 'react';

// "Off day" suggestions — what to do instead when there are no games.
// Voice matches the rest of the site (friend in the group chat, light
// slang, never preachy). Keep these short — they read as text-message-
// length nudges, not advice.
//
// Adding to this pool is free — the empty state picks 4 at random per
// render. Keep emoji to common widely-rendered ones (skip flags, hands,
// or anything with skin tones — they look different on Android vs iOS).
const SUGGESTIONS: { emoji: string; text: string }[] = [
  { emoji: '🏋️', text: 'Lock in at the gym' },
  { emoji: '☕', text: 'Coffee with someone — your call' },
  { emoji: '📱', text: 'Text the friend you ghosted' },
  { emoji: '📺', text: 'Finally finish that show' },
  { emoji: '🚶', text: 'Walk somewhere new' },
  { emoji: '🎮', text: 'Beat your top score' },
  { emoji: '📚', text: 'Read a chapter, then nap' },
  { emoji: '🍕', text: 'Order from that place you keep saving' },
  { emoji: '🎧', text: 'Find a new playlist' },
  { emoji: '👨‍🍳', text: "Cook something you've never tried" },
  { emoji: '🌳', text: 'Touch grass (literally)' },
  { emoji: '📅', text: "Plan next week's hang" },
  { emoji: '🎬', text: 'Pick a classic on Netflix' },
  { emoji: '🛋️', text: 'Patio sit. No agenda.' },
  { emoji: '🏀', text: 'YouTube a vintage game' },
  { emoji: '🧘', text: '20 minutes of silence' },
];

interface EmptyStateProps {
  cityName: string;
}

export default function EmptyState({ cityName }: EmptyStateProps) {
  // Randomize once per mount so suggestions don't shuffle on every state
  // change inside the parent, but DO change across visits. useMemo with
  // empty deps is the sweet spot.
  const picks = useMemo(() => {
    return [...SUGGESTIONS]
      .sort(() => Math.random() - 0.5)
      .slice(0, 4);
  }, []);

  return (
    <div
      className="rounded-3xl p-7 text-center"
      style={{
        background: '#15151c',
        border: '1px solid rgba(255,255,255,0.05)',
        boxShadow: '0 2px 24px rgba(0,0,0,0.35)',
      }}
    >
      <div className="text-4xl mb-3" aria-hidden="true">🛋️</div>
      <h3
        className="text-3xl tracking-tight"
        style={{
          color: '#fafafa',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          letterSpacing: '-0.025em',
          lineHeight: 1.1,
        }}
      >
        Off day in {cityName || 'town'}.
      </h3>
      <p className="text-sm mt-2 mb-6" style={{ color: '#9090a0' }}>
        Nothing on the schedule. Some ideas while you wait:
      </p>

      <div className="grid grid-cols-2 gap-2 text-left">
        {picks.map((s, i) => (
          <div
            key={i}
            className="rounded-xl px-3 py-3 text-sm font-medium flex items-start gap-2"
            style={{
              background: '#1f1f28',
              color: '#fafafa',
              border: '1px solid rgba(255,255,255,0.04)',
            }}
          >
            <span className="text-base leading-none shrink-0" aria-hidden="true">{s.emoji}</span>
            <span className="leading-snug">{s.text}</span>
          </div>
        ))}
      </div>

      <p className="text-[11px] mt-5" style={{ color: '#52525b' }}>
        Try a different date — there might be a game tomorrow.
      </p>
    </div>
  );
}
