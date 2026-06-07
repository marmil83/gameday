'use client';

import { useState, useEffect, useCallback } from 'react';
import type { GameCard as GameCardType } from '@/types/database';
import GameCard from './GameCard';
import CityNav from './CityNav';
import CityPicker from './CityPicker';
import EmptyState from './EmptyState';

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Today (and offset days) in a SPECIFIC timezone — required because the
// schedule the user sees is whatever's happening in the city's local
// frame, not their own. A user in Eastern looking at Portland should
// have the "Today" pill match Portland's date, not Detroit's.
function dateInTimezone(offset: number, timezone?: string): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  if (!timezone) return formatLocalDate(d);
  return d.toLocaleDateString('en-CA', { timeZone: timezone });
}

// URL slug ↔ canonical city name. Dynamic (not a hardcoded list) so
// any city we add to the DB works automatically — "Los Angeles" ⇄
// "los-angeles", "New York" ⇄ "new-york", etc. The API still receives
// the canonical name; if a slug doesn't match a real city the API
// returns no games and we fall back gracefully.
function citySlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '-');
}
function cityFromSlug(slug: string): string {
  return slug
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

// Returns the city to load on first paint, or '' to defer to geo-detection.
// Priority: explicit ?city= in the URL > previously saved choice in
// localStorage > '' (triggers /api/detect-city, then the CityPicker if geo
// can't resolve). No hardcoded default city — we'd rather make the visitor
// choose than guess wrong.
function readInitialCity(): string {
  if (typeof window === 'undefined') return '';
  const slug = new URLSearchParams(window.location.search).get('city')?.toLowerCase();
  if (slug) return cityFromSlug(slug);
  try {
    const saved = window.localStorage.getItem('wg_city');
    if (saved) return saved;
  } catch { /* private mode etc. */ }
  return '';
}

function readInitialDate(): string {
  if (typeof window === 'undefined') return '';
  const d = new URLSearchParams(window.location.search).get('date') || '';
  // Only accept YYYY-MM-DD; anything malformed falls back to "" (today).
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
}

export default function GameList() {
  const [city, setCity] = useState(readInitialCity);
  const [games, setGames] = useState<GameCardType[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(readInitialDate);
  const [cityInfo, setCityInfo] = useState({ name: '', state: '', timezone: '' });
  // True when we've decided the visitor needs to pick a city (geo couldn't
  // resolve to one of our markets). Blocks the games UI behind a modal.
  const [needsCityChoice, setNeedsCityChoice] = useState(false);

  // First-visit geo detection. Only fires when we have no city yet (no URL
  // param, no localStorage). If geo lands on an active market, silently
  // use it. Otherwise raise the picker.
  useEffect(() => {
    if (city) return;
    let cancelled = false;
    fetch('/api/detect-city')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data.city) {
          setCity(data.city);
          try { window.localStorage.setItem('wg_city', data.city); } catch {}
        } else {
          setNeedsCityChoice(true);
        }
      })
      .catch(() => { if (!cancelled) setNeedsCityChoice(true); });
    return () => { cancelled = true; };
  }, [city]);

  // Mirror city + date into the URL without reloading the page, so the
  // current view is shareable. replaceState (not pushState) avoids
  // polluting browser history on every date-pill click.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    if (city) params.set('city', citySlug(city));
    if (date) params.set('date', date);
    const qs = params.toString();
    const next = qs ? `?${qs}` : window.location.pathname;
    if (window.location.search !== (qs ? `?${qs}` : '')) {
      window.history.replaceState(null, '', next);
    }
  }, [city, date]);

  // Switching cities should always land on "today" — a date that
  // exists in one city's schedule rarely makes sense in another, and
  // it matches the natural user mental model of "let me see what's
  // happening in <new city> now."
  const handleCityChange = useCallback((next: string) => {
    setCity(next);
    setDate('');
    setNeedsCityChoice(false);
    try { window.localStorage.setItem('wg_city', next); } catch {}
  }, []);

  const fetchGames = useCallback(async () => {
    // No city yet → we're still detecting / waiting for picker. Stay in
    // loading state so the skeletons render instead of "No games today".
    if (!city) { setLoading(true); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ city });
      if (date) params.set('date', date);

      const res = await fetch(`/api/games?${params}`);
      const data = await res.json();
      setGames(data.games || []);
      setCityInfo(data.city || { name: city, state: '', timezone: 'America/New_York' });
      // Intentionally NOT promoting data.date into local state. Doing so
      // caused two bugs when crossing timezones: the API resolves "today"
      // in the city's frame (e.g. Portland → Pacific), but the date pills
      // were comparing against the user's browser-local today — so the
      // Today pill could deselect even though we were showing today's
      // games, and an extra refetch fired with the now-set date.
    } catch {
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [city, date]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  // "Today" is relative to the CITY being viewed, not the user's browser.
  // Falls back to browser-local before cityInfo has loaded.
  const today = dateInTimezone(0, cityInfo.timezone);
  const isToday = !date || date === today;

  return (
    <div className="min-h-screen" style={{ background: '#0a0a0d' }}>
      {needsCityChoice && <CityPicker onPick={handleCityChange} />}
      {/* Sticky top nav — wordmark + city pills together so the
          supported markets stay visible as the user scrolls through
          games. Detroit + Portland are soft-hidden via
          cities.is_active=false; flip back on and they auto-reappear. */}
      <header
        className="backdrop-blur-md border-b sticky top-0 z-10"
        style={{ background: 'rgba(10,10,13,0.78)', borderColor: 'rgba(255,255,255,0.06)' }}
      >
        <div className="max-w-lg mx-auto px-5 py-3 flex items-center gap-3">
          <h1
            className="text-xl shrink-0"
            style={{
              color: '#fafafa',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            WorthGoing
          </h1>
          <div className="flex-1 min-w-0">
            <CityNav currentCity={city} onCityChange={handleCityChange} />
          </div>
        </div>
      </header>

      {/* Headline + date nav */}
      <div className="max-w-lg mx-auto px-5 pt-8 pb-3">
        <h2
          className="text-4xl tracking-tight"
          style={{
            color: '#fafafa',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
          }}
        >
          {isToday
            ? "Today's Games"
            : new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        <p className="text-sm mt-2" style={{ color: '#7a7a85' }}>
          {cityInfo.name}{cityInfo.state ? `, ${cityInfo.state}` : ''} &middot;{' '}
          {games.length} {games.length === 1 ? 'game' : 'games'}
        </p>

        {/* Date pills */}
        <div className="flex gap-2 mt-5">
          {[0, 1, 2].map(offset => {
            const dStr = dateInTimezone(offset, cityInfo.timezone);
            const label = offset === 0
              ? 'Today'
              : offset === 1
                ? 'Tomorrow'
                : new Date(dStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
            const active = date === dStr || (offset === 0 && !date);

            return (
              <button
                key={dStr}
                onClick={() => setDate(dStr)}
                className="px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200"
                style={active
                  ? { background: '#fafafa', color: '#0a0a0d' }
                  : { background: '#1a1a22', color: '#fafafa', border: '1px solid rgba(255,255,255,0.08)' }
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Game Cards */}
      <main className="max-w-lg mx-auto px-5 py-4 space-y-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-3xl h-72 animate-pulse" style={{ background: '#15151c', opacity: 0.6 }} />
            ))}
          </div>
        ) : games.length > 0 ? (
          games.map((gameData) => (
            <GameCard key={gameData.game.id} data={gameData} timezone={cityInfo.timezone} />
          ))
        ) : (
          <EmptyState cityName={cityInfo.name} />
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-lg mx-auto px-5 py-10 text-center">
        <p className="text-xs" style={{ color: '#52525b' }}>
          Prices may not include all fees. Always verify at checkout.
        </p>
      </footer>
    </div>
  );
}
