// WorthGoing Database Types
// These mirror the Supabase schema and are used throughout the application

export type PricingTransparency = 'all_in_verified' | 'estimated_with_fees' | 'base_price_only';
export type GameStatus = 'scheduled' | 'live' | 'final' | 'postponed' | 'cancelled';
export type PipelineStatus = 'pending' | 'enriched' | 'reviewed' | 'published';
export type PromoType = 'giveaway' | 'theme_night' | 'fireworks' | 'special_ticket' | 'family_promo' | 'food_bev_promo';
export type EffortLevel = 'easy' | 'moderate' | 'high_effort';
export type SourceType = 'ai' | 'admin' | 'rule';
export type LeagueLevel = 'major' | 'minor';
export type VenueType = 'indoor' | 'outdoor';

export type VibeTag =
  | 'family-friendly'
  | 'high-energy'
  | 'cheap-night'
  | 'date-night'
  | 'chill'
  | 'promo-driven';

export type TargetAudience =
  | 'families'
  | 'date night'
  | 'casual fans'
  | 'hardcore fans'
  | 'cheap night out'
  | 'social outing';

// ============================================================
// Database Row Types
// ============================================================

export interface City {
  id: string;
  name: string;
  state: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  short_name: string;
  abbreviation: string | null;
  league: string;
  league_level: LeagueLevel;
  city_id: string;
  venue_name: string | null;
  venue_type: VenueType | null;
  logo_url: string | null;
  promo_page_url: string | null;
  seatgeek_slug: string | null;
  external_ids: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface Game {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  league: string;
  venue: string;
  city_id: string;
  start_time: string;
  status: GameStatus;
  source: string;
  source_event_id: string | null;
  affiliate_url: string | null;
  is_home_game: boolean;
  is_featured: boolean;
  is_hidden: boolean;
  is_published: boolean;
  pipeline_status: PipelineStatus;
  created_at: string;
  updated_at: string;
}

export interface PricingSnapshot {
  id: string;
  game_id: string;
  source_name: string;
  lowest_price: number | null;
  avg_price: number | null;
  median_price: number | null;
  displayed_price: number | null;
  base_price: number | null;
  mandatory_fees: number | null;
  estimated_tax: number | null;
  pricing_transparency: PricingTransparency;
  affiliate_url: string | null;
  listing_count: number | null;
  captured_at: string;
}

export interface Promotion {
  id: string;
  game_id: string;
  source_url: string | null;
  raw_text: string | null;
  promo_type: PromoType | null;
  promo_item: string | null;
  promo_description: string | null;
  special_ticket_required: boolean;
  eligibility_details: string | null;
  promo_clarity: string | null;
  confidence_score: number;
  is_ai_extracted: boolean;
  is_admin_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface Score {
  id: string;
  game_id: string;
  price_score: number;
  experience_score: number;
  game_quality_score: number;
  timing_score: number;
  context_score: number;
  deal_score: number;
  reasoning_summary: string | null;
  score_breakdown: Record<string, unknown>;
  updated_at: string;
}

export interface Tag {
  id: string;
  game_id: string;
  tag_name: VibeTag;
  source_type: SourceType;
  confidence_score: number;
  created_at: string;
}

export interface GameInsight {
  id: string;
  game_id: string;
  expectation_summary: string | null;
  target_audience: TargetAudience[];
  effort_level: EffortLevel;
  price_insight: string | null;
  promo_clarity: string | null;
  seat_expectation: string | null;
  context_flags: string[];
  verdict: string | null;
  why_worth_it: string | null;
  confidence_score: number;
  weather_temp_f: number | null;
  weather_condition: string | null;
  weather_icon: string | null;
  weather_score: number | null;
  updated_at: string;
}

export interface AdminOverride {
  id: string;
  game_id: string;
  admin_user_id: string | null;
  field_name: string;
  table_name: string;
  original_value: string | null;
  override_value: string | null;
  override_reason: string | null;
  created_at: string;
}

export interface PipelineRun {
  id: string;
  run_type: string;
  city_id: string | null;
  status: string;
  games_found: number;
  games_enriched: number;
  errors: unknown[];
  started_at: string;
  completed_at: string | null;
}

// ============================================================
// Composite Types (for API responses / frontend)
// ============================================================

export interface GameCard {
  game: Game;
  pricing: PricingSnapshot | null;        // cheapest snapshot (headline price)
  all_pricing: PricingSnapshot[];          // all snapshots, one per source
  promotions: Promotion[];
  score: Score | null;
  tags: Tag[];
  insights: GameInsight | null;
  home_team_logo: string | null;
  away_team_logo: string | null;
}

export interface CityGames {
  city: City;
  date: string;
  games: GameCard[];
}
