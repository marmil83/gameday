// Admin API: CRUD for games
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase/server';

async function requireAdmin() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Unauthorized');
  return user;
}

// GET /api/admin/games — list all games (with full data)
export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const cityName = searchParams.get('city');
  const status = searchParams.get('status');
  const date = searchParams.get('date');

  const supabase = createServiceClient();

  let query = supabase
    .from('games')
    .select(`
      *,
      scores (*),
      tags (*),
      game_insights (*),
      promotions (*),
      pricing_snapshots (*)
    `)
    .order('start_time', { ascending: true });

  if (status) {
    query = query.eq('pipeline_status', status);
  }

  if (date) {
    query = query
      .gte('start_time', `${date}T00:00:00.000Z`)
      .lte('start_time', `${date}T23:59:59.999Z`);
  }

  const { data: games, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter by city name if provided
  if (cityName) {
    const { data: city } = await supabase
      .from('cities')
      .select('id')
      .ilike('name', cityName)
      .single();

    if (city) {
      return NextResponse.json({
        games: (games || []).filter(g => g.city_id === city.id),
      });
    }
  }

  return NextResponse.json({ games: games || [] });
}

// PATCH /api/admin/games — update a game (with override tracking)
export async function PATCH(request: NextRequest) {
  let user;
  try {
    user = await requireAdmin();
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { game_id, updates, reason } = body;

  if (!game_id || !updates) {
    return NextResponse.json({ error: 'game_id and updates required' }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Get current game for override tracking
  const { data: currentGame } = await supabase
    .from('games')
    .select('*')
    .eq('id', game_id)
    .single();

  if (!currentGame) {
    return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  }

  // Track overrides
  for (const [field, newValue] of Object.entries(updates)) {
    const originalValue = (currentGame as Record<string, unknown>)[field];
    if (originalValue !== undefined && String(originalValue) !== String(newValue)) {
      await supabase.from('admin_overrides').insert({
        game_id,
        admin_user_id: user.id,
        field_name: field,
        table_name: 'games',
        original_value: String(originalValue),
        override_value: String(newValue),
        override_reason: reason || null,
      });
    }
  }

  // Apply updates
  const { error } = await supabase
    .from('games')
    .update(updates)
    .eq('id', game_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
