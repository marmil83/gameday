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
    <div className="pt-3">
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
        {cities.map(city => {
          const active = city.name === currentCity;
          return (
            <button
              key={city.id}
              onClick={() => onCityChange(city.name)}
              className="shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-150 active:scale-[0.97]"
              style={active
                ? { background: '#1d1d1f', color: '#ffffff' }
                : { background: '#ffffff', color: '#1d1d1f', border: '1px solid rgba(0,0,0,0.1)' }
              }
            >
              {city.name}
            </button>
          );
        })}
      </div>
      {/* "Coming soon" hint — sets expectations without being a feature */}
      <p className="text-[11px] mt-2" style={{ color: '#86868b' }}>
        More cities coming soon
      </p>
    </div>
  );
}
