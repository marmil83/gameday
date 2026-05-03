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

export default function GameList() {
  const [city, setCity] = useState('Detroit');
  const [games, setGames] = useState<GameCardType[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [cityInfo, setCityInfo] = useState({ name: '', state: '', timezone: '' });

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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-gray-900">GameDay</h1>
              <p className="text-xs text-gray-400">Worth the trip?</p>
            </div>
            <CitySelector currentCity={city} onCityChange={setCity} />
          </div>
        </div>
      </header>

      {/* Headline */}
      <div className="max-w-lg mx-auto px-4 pt-6 pb-2">
        <h2 className="text-2xl font-bold text-gray-900">
          {isToday ? 'Games worth going to today' : `Games on ${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {cityInfo.name}{cityInfo.state ? `, ${cityInfo.state}` : ''} &middot;{' '}
          {games.length} {games.length === 1 ? 'game' : 'games'} curated for you
        </p>

        {/* Date nav */}
        <div className="flex gap-2 mt-4">
          {[0, 1, 2].map(offset => {
            const d = new Date();
            d.setDate(d.getDate() + offset);
            const dStr = formatLocalDate(d);
            const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' });

            return (
              <button
                key={dStr}
                onClick={() => setDate(dStr)}
                className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                  date === dStr || (offset === 0 && !date)
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Game Cards */}
      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white rounded-2xl h-64 animate-pulse" />
            ))}
          </div>
        ) : games.length > 0 ? (
          games.map((gameData) => (
            <GameCard key={gameData.game.id} data={gameData} timezone={cityInfo.timezone} />
          ))
        ) : (
          <div className="text-center py-16">
            <p className="text-gray-400 text-lg font-medium">No games found</p>
            <p className="text-gray-400 text-sm mt-1">
              Check back later or try a different date
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-lg mx-auto px-4 py-8 text-center">
        <p className="text-xs text-gray-400">
          Prices may not include all fees. Always verify at checkout.
        </p>
      </footer>
    </div>
  );
}
