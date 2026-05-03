// GET /api/cities — returns all active cities
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = createServiceClient();

  const { data: cities } = await supabase
    .from('cities')
    .select('id, name, state, timezone')
    .eq('is_active', true)
    .order('name');

  return NextResponse.json({ cities: cities || [] });
}
