'use client';

import { useState, useEffect } from 'react';

interface City {
  id: string;
  name: string;
  state: string;
}

interface CityNavProps {
  currentCity: string;
  onCityChange: (city: string) => void;
}

// Short labels for the header pills — full names don't fit on narrow
// phones. Keys are the canonical city name in the DB. Falls back to the
// full name if a city isn't in the map (so newly-added cities still render
// — they just won't be tight until we add an abbreviation here).
const CITY_SHORT: Record<string, string> = {
  'New York': 'NY',
  'Los Angeles': 'LA',
  Chicago: 'CHI',
  Detroit: 'DET',
  Portland: 'PDX',
};

// Replaces the old dropdown-style CitySelector with a horizontal pill row.
// With only a handful of cities active, "tap to switch" beats "open menu →
// pick" — and visually broadcasts which markets we cover. When the city
// list grows past what fits on one row we'll need to revisit (scroll,
// dropdown fallback, or a different layout), but for the current 3-city
// focused launch this is the clearest UX.
export default function CityNav({ currentCity, onCityChange }: CityNavProps) {
  const [cities, setCities] = useState<City[]>([]);

  useEffect(() => {
    fetch('/api/cities')
      .then(res => res.json())
      .then(data => setCities(data.cities || []))
      .catch(() => {});
  }, []);

  if (cities.length === 0) return null;

  return (
    <div className="flex items-center justify-end gap-1.5 overflow-x-auto">
      {cities.map(city => {
        const active = city.name === currentCity;
        return (
          <button
            key={city.id}
            onClick={() => onCityChange(city.name)}
            className="shrink-0 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-150 active:scale-[0.97]"
            style={active
              ? { background: '#fafafa', color: '#0a0a0d' }
              : { background: '#1a1a22', color: '#fafafa', border: '1px solid rgba(255,255,255,0.08)' }
            }
          >
            {CITY_SHORT[city.name] ?? city.name}
          </button>
        );
      })}
    </div>
  );
}
