'use client';

import { useState, useEffect } from 'react';

interface City {
  id: string;
  name: string;
  state: string;
}

interface CitySelectorProps {
  currentCity: string;
  onCityChange: (city: string) => void;
}

export default function CitySelector({ currentCity, onCityChange }: CitySelectorProps) {
  const [cities, setCities] = useState<City[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/cities')
      .then(res => res.json())
      .then(data => setCities(data.cities || []))
      .catch(() => {});
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        {currentCity}
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && cities.length > 0 && (
        <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-lg border border-gray-100 py-1 min-w-[160px] z-50">
          {cities.map(city => (
            <button
              key={city.id}
              onClick={() => {
                onCityChange(city.name);
                setOpen(false);
              }}
              className={`block w-full text-left px-4 py-2 text-sm hover:bg-gray-50 transition-colors ${
                city.name === currentCity ? 'font-semibold text-gray-900' : 'text-gray-600'
              }`}
            >
              {city.name}, {city.state}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
