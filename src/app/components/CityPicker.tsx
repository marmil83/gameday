'use client';

import { useState, useEffect } from 'react';

interface City {
  id: string;
  name: string;
  state: string;
}

interface CityPickerProps {
  onPick: (city: string) => void;
}

// First-visit modal shown when IP geo can't put the visitor in one of our
// markets (international, or a US state that doesn't map to NY/LA/CHI).
// Forces a choice before games load — there's no useful default, and we'd
// rather make the visitor commit than show them games for a city they
// didn't ask for.
export default function CityPicker({ onPick }: CityPickerProps) {
  const [cities, setCities] = useState<City[]>([]);

  useEffect(() => {
    fetch('/api/cities')
      .then(res => res.json())
      .then(data => setCities(data.cities || []))
      .catch(() => {});
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-5">
      <div className="bg-white rounded-3xl p-7 max-w-sm w-full shadow-2xl">
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#1d1d1f' }}>
          Pick your city
        </h2>
        <p className="text-sm mt-2 mb-6" style={{ color: '#86868b' }}>
          We&apos;re live in three markets. Choose one to see what&apos;s worth going to.
        </p>

        <div className="space-y-2">
          {cities.map(city => (
            <button
              key={city.id}
              onClick={() => onPick(city.name)}
              className="w-full text-left px-5 py-4 rounded-2xl font-semibold transition-all duration-150 active:scale-[0.98]"
              style={{ background: '#F2F2F7', color: '#1d1d1f' }}
            >
              <span className="text-base">{city.name}</span>
              {city.state ? (
                <span className="text-sm ml-2" style={{ color: '#86868b' }}>{city.state}</span>
              ) : null}
            </button>
          ))}
        </div>

        <p className="text-[11px] mt-5 text-center" style={{ color: '#86868b' }}>
          More cities coming soon
        </p>
      </div>
    </div>
  );
}
