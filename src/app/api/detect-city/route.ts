// GET /api/detect-city — picks the nearest active city based on the
// visitor's IP geo (Vercel-injected headers). Returns { city: string }
// when we have a confident match, or { city: null } when the visitor is
// outside the US (or in a US state we can't map) — the client then shows
// the city picker so the visitor chooses before we load any games.
//
// Why not browser geolocation? It prompts for permission, which is too
// heavy for a first-visit "where are you" question. IP geo is silent,
// good enough for "nearest of 3 markets," and gracefully degrades to the
// picker when it can't decide.

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

// Rough US-state → nearest active market. Three buckets: Northeast/
// SE/Mid-Atlantic → NY, Midwest/South-central → CHI, West/Mountain → LA.
// This is a "which of our three" guess, not real distance — once we add
// more markets we'll revisit with actual lat/lon.
const STATE_TO_CITY: Record<string, string> = {
  // → New York
  NY: 'New York', NJ: 'New York', PA: 'New York', CT: 'New York', RI: 'New York',
  MA: 'New York', VT: 'New York', NH: 'New York', ME: 'New York', MD: 'New York',
  DE: 'New York', DC: 'New York', VA: 'New York', WV: 'New York', NC: 'New York',
  SC: 'New York', GA: 'New York', FL: 'New York',
  // → Chicago
  IL: 'Chicago', IN: 'Chicago', OH: 'Chicago', MI: 'Chicago', WI: 'Chicago',
  MN: 'Chicago', IA: 'Chicago', MO: 'Chicago', KS: 'Chicago', NE: 'Chicago',
  ND: 'Chicago', SD: 'Chicago', KY: 'Chicago', TN: 'Chicago', AR: 'Chicago',
  OK: 'Chicago', TX: 'Chicago', LA: 'Chicago', MS: 'Chicago', AL: 'Chicago',
  // → Los Angeles
  CA: 'Los Angeles', OR: 'Los Angeles', WA: 'Los Angeles', NV: 'Los Angeles',
  AZ: 'Los Angeles', UT: 'Los Angeles', ID: 'Los Angeles', MT: 'Los Angeles',
  WY: 'Los Angeles', CO: 'Los Angeles', NM: 'Los Angeles', AK: 'Los Angeles',
  HI: 'Los Angeles',
};

export async function GET() {
  const h = await headers();
  const country = h.get('x-vercel-ip-country') || '';
  const region = h.get('x-vercel-ip-country-region') || '';

  let candidate: string | null = null;
  if (country === 'US' && region in STATE_TO_CITY) {
    candidate = STATE_TO_CITY[region];
  }

  // Confirm the candidate is still active — protects against returning a
  // soft-hidden city if the state map drifts ahead of the DB.
  if (candidate) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from('cities')
      .select('name')
      .eq('name', candidate)
      .eq('is_active', true)
      .maybeSingle();
    if (!data) candidate = null;
  }

  return NextResponse.json(
    { city: candidate },
    // Vary by IP-region so the CDN doesn't serve one visitor's region to
    // another. Short max-age — geo is cheap to compute.
    {
      headers: {
        'Cache-Control': 'private, max-age=60',
        Vary: 'x-vercel-ip-country-region',
      },
    },
  );
}
