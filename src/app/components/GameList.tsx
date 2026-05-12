'use client';

import { useState, useEffect, useCallback } from 'react';
import type { GameCard as GameCardType } from '@/types/database';
import GameCard from './GameCard';
import CitySelector from './CitySelector';

function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Map URL-friendly slugs ↔ canonical city names. Slugs are what we put
// in the address bar; the API still takes the canonical name. Keeping
// the map small and explicit (rather than a generic slugify) means an
// unrecognized ?city= silently falls back to the default instead of
// 404'ing the API with garbage.
const CITY_SLUGS: Record<string, string> = {
  detroit: 'Detroit',
  portland: 'Portland',
};
const CITY_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(CITY_SLUGS).map(([slug, name]) => [name, slug])
);

function readInitialCity(): string {
  if (typeof window === 'undefined') return 'Detroit';
  const slug = new URLSearchParams(window.location.search).get('city')?.toLowerCase();
  return (slug && CITY_SLUGS[slug]) || 'Detroit';
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

  // Mirror city + date into the URL without reloading the page, so the
  // current view is shareable. replaceState (not pushState) avoids
  // polluting browser history on every date-pill click.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams();
    const slug = CITY_TO_SLUG[city];
    if (slug && slug !== 'detroit') params.set('city', slug); // default city stays clean
    if (date) params.set('date', date);
    const qs = params.toString();
    const next = qs ? `?${qs}` : window.location.pathname;
    if (window.location.search !== (qs ? `?${qs}` : '')) {
      window.history.replaceState(null, '', next);
    }
  }, [city, date]);

  const fetchGames = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ city });
      if (date) params.set('date', date);

      const res = await fetch(`/api/games?${params}`);
      const data = await res.json();
      setGames(data.games || []);
      setCityInfo(data.city || { name: city, state: '', timezone: 'America/New_York' });
      if (!date) setDate(data.date || '');
    } catch {
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [city, date]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  const today = formatLocalDate(new Date());
  const isToday = date === today || !date;

  return (
    <div className="min-h-screen" style={{ background: '#F2F2F7' }}>
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-black/5 sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold tracking-tight" style={{ color: '#1d1d1f' }}>WorthGoing</h1>
              <p className="text-xs mt-0.5" style={{ color: '#86868b' }}>Know Before You Go</p>
            </div>
            <CitySelector currentCity={city} onCityChange={setCity} />
          </div>
        </div>
      </header>

      {/* Headline + date nav */}
      <div className="max-w-lg mx-auto px-5 pt-8 pb-3">
        <h2 className="text-3xl font-bold tracking-tight" style={{ color: '#1d1d1f' }}>
          {isToday
            ? 'Today\'s Games'
            : new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        <p className="text-sm mt-1" style={{ color: '#86868b' }}>
          {cityInfo.name}{cityInfo.state ? `, ${cityInfo.state}` : ''} &middot;{' '}
          {games.length} {games.length === 1 ? 'game' : 'games'}
        </p>

        {/* Date pills */}
        <div className="flex gap-2 mt-5">
          {[0, 1, 2].map(offset => {
            const d = new Date();
            d.setDate(d.getDate() + offset);
            const dStr = formatLocalDate(d);
            const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' });
            const active = date === dStr || (offset === 0 && !date);

            return (
              <button
                key={dStr}
                onClick={() => setDate(dStr)}
                className="px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200"
                style={active
                  ? { background: '#1d1d1f', color: '#ffffff' }
                  : { background: '#ffffff', color: '#1d1d1f', border: '1px solid rgba(0,0,0,0.1)' }
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
              <div key={i} className="bg-white rounded-3xl h-72 animate-pulse" style={{ opacity: 0.6 }} />
            ))}
          </div>
        ) : games.length > 0 ? (
          games.map((gameData) => (
            <GameCard key={gameData.game.id} data={gameData} timezone={cityInfo.timezone} />
          ))
        ) : (
          <div className="text-center py-20">
            <p className="text-lg font-medium" style={{ color: '#86868b' }}>No games today</p>
            <p className="text-sm mt-1" style={{ color: '#86868b' }}>Try a different date</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-lg mx-auto px-5 py-10 text-center">
        <p className="text-xs" style={{ color: '#aeaeb2' }}>
          Prices may not include all fees. Always verify at checkout.
        </p>
      </footer>
    </div>
  );
}
