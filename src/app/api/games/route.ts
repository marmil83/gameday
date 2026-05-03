// GET /api/games — Public API: returns top games for a city
import { NextRequest, NextResponse } from 'next/server';
import { getTopGamesForCity } from '@/lib/pipeline/enrich';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const cityName = searchParams.get('city') || 'Detroit';
  const date = searchParams.get('date'); // optional YYYY-MM-DD

  const supabase = createServiceClient();

  // Look up city
  const { data: city } = await supabase
    .from('cities')
    .select('id, name, state, timezone')
    .ilike('name', cityName)
    .single();

  if (!city) {
    return NextResponse.json({ error: 'City not found' }, { status: 404 });
  }

  // Use the city's timezone for "today" to avoid UTC date mismatch
  const targetDate = date || new Date().toLocaleDateString('en-CA', { timeZone: city.timezone });

  const games = await getTopGamesForCity(city.id, targetDate, undefined, city.timezone);

  return NextResponse.json({
    city: { name: city.name, state: city.state, timezone: city.timezone },
    date: targetDate,
    games,
  });
}
