-- ============================================================
-- Foamfinger Database Setup Script
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Copy-paste this entire file and click "Run"
-- ============================================================

-- STEP 1: Schema
-- ============================================================

CREATE TABLE cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, state)
);

CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  abbreviation TEXT,
  league TEXT NOT NULL,
  league_level TEXT NOT NULL DEFAULT 'major',
  city_id UUID NOT NULL REFERENCES cities(id),
  venue_name TEXT,
  venue_type TEXT,
  logo_url TEXT,
  promo_page_url TEXT,
  seatgeek_slug TEXT,
  external_ids JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_city ON teams(city_id);
CREATE INDEX idx_teams_league ON teams(league);

CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  home_team_id UUID NOT NULL REFERENCES teams(id),
  away_team_id UUID NOT NULL REFERENCES teams(id),
  home_team_name TEXT NOT NULL,
  away_team_name TEXT NOT NULL,
  league TEXT NOT NULL,
  venue TEXT NOT NULL,
  city_id UUID NOT NULL REFERENCES cities(id),
  start_time TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  source TEXT NOT NULL DEFAULT 'api',
  source_event_id TEXT,
  affiliate_url TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT true,
  pipeline_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_event_id, source)
);

CREATE INDEX idx_games_city_start ON games(city_id, start_time);
CREATE INDEX idx_games_start_time ON games(start_time);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_pipeline ON games(pipeline_status);

CREATE TABLE pricing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  lowest_price NUMERIC(10,2),
  avg_price NUMERIC(10,2),
  median_price NUMERIC(10,2),
  displayed_price NUMERIC(10,2),
  base_price NUMERIC(10,2),
  mandatory_fees NUMERIC(10,2),
  estimated_tax NUMERIC(10,2),
  pricing_transparency TEXT NOT NULL DEFAULT 'base_price_only',
  affiliate_url TEXT,
  listing_count INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_game ON pricing_snapshots(game_id);
CREATE INDEX idx_pricing_captured ON pricing_snapshots(captured_at);

CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source_url TEXT,
  raw_text TEXT,
  promo_type TEXT,
  promo_item TEXT,
  promo_description TEXT,
  special_ticket_required BOOLEAN DEFAULT false,
  eligibility_details TEXT,
  promo_clarity TEXT,
  confidence_score NUMERIC(3,2) DEFAULT 0.0,
  is_ai_extracted BOOLEAN NOT NULL DEFAULT false,
  is_admin_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_promotions_game ON promotions(game_id);

CREATE TABLE scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  price_score NUMERIC(4,2) DEFAULT 0,
  experience_score NUMERIC(4,2) DEFAULT 0,
  game_quality_score NUMERIC(4,2) DEFAULT 0,
  timing_score NUMERIC(4,2) DEFAULT 0,
  context_score NUMERIC(4,2) DEFAULT 0,
  deal_score NUMERIC(4,2) DEFAULT 0,
  reasoning_summary TEXT,
  score_breakdown JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_id)
);

CREATE INDEX idx_scores_deal ON scores(deal_score DESC);

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'ai',
  confidence_score NUMERIC(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_id, tag_name)
);

CREATE INDEX idx_tags_game ON tags(game_id);

CREATE TABLE game_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  expectation_summary TEXT,
  target_audience TEXT[] DEFAULT '{}',
  effort_level TEXT DEFAULT 'moderate',
  price_insight TEXT,
  promo_clarity TEXT,
  seat_expectation TEXT,
  context_flags TEXT[] DEFAULT '{}',
  verdict TEXT,
  why_worth_it TEXT,
  confidence_score NUMERIC(3,2) DEFAULT 0.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_id)
);

CREATE INDEX idx_insights_game ON game_insights(game_id);

CREATE TABLE admin_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  admin_user_id UUID,
  field_name TEXT NOT NULL,
  table_name TEXT NOT NULL DEFAULT 'games',
  original_value TEXT,
  override_value TEXT,
  override_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_overrides_game ON admin_overrides(game_id);

CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL,
  city_id UUID REFERENCES cities(id),
  status TEXT NOT NULL DEFAULT 'running',
  games_found INTEGER DEFAULT 0,
  games_enriched INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER promotions_updated_at BEFORE UPDATE ON promotions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER scores_updated_at BEFORE UPDATE ON scores FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER game_insights_updated_at BEFORE UPDATE ON game_insights FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ============================================================
-- STEP 2: Row Level Security (RLS)
-- Public can read games/cities/etc, only service role can write
-- ============================================================

ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

-- Public read access for frontend
CREATE POLICY "Public read cities" ON cities FOR SELECT USING (true);
CREATE POLICY "Public read teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Public read games" ON games FOR SELECT USING (true);
CREATE POLICY "Public read pricing" ON pricing_snapshots FOR SELECT USING (true);
CREATE POLICY "Public read promotions" ON promotions FOR SELECT USING (true);
CREATE POLICY "Public read scores" ON scores FOR SELECT USING (true);
CREATE POLICY "Public read tags" ON tags FOR SELECT USING (true);
CREATE POLICY "Public read insights" ON game_insights FOR SELECT USING (true);

-- Service role bypasses RLS automatically, so no write policies needed
-- Admin overrides and pipeline_runs are internal only (accessed via service role)


-- ============================================================
-- STEP 3: Seed data — Cities and Teams
-- ============================================================

INSERT INTO cities (name, state, timezone) VALUES
  ('Detroit', 'MI', 'America/Detroit'),
  ('Portland', 'OR', 'America/Los_Angeles')
ON CONFLICT (name, state) DO NOTHING;

-- Detroit teams
INSERT INTO teams (name, short_name, abbreviation, league, league_level, city_id, venue_name, venue_type, promo_page_url, seatgeek_slug)
VALUES
  ('Detroit Tigers', 'Tigers', 'DET', 'MLB', 'major',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Comerica Park', 'outdoor',
    'https://www.mlb.com/tigers/tickets/promotions',
    'detroit-tigers'),
  ('Detroit Lions', 'Lions', 'DET', 'NFL', 'major',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Ford Field', 'indoor',
    'https://www.detroitlions.com/tickets/promotions',
    'detroit-lions'),
  ('Detroit Pistons', 'Pistons', 'DET', 'NBA', 'major',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Little Caesars Arena', 'indoor',
    'https://www.nba.com/pistons/tickets/promotions',
    'detroit-pistons'),
  ('Detroit Red Wings', 'Red Wings', 'DET', 'NHL', 'major',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Little Caesars Arena', 'indoor',
    'https://www.nhl.com/redwings/tickets/promotions',
    'detroit-red-wings'),
  ('Toledo Mud Hens', 'Mud Hens', 'TOL', 'MiLB-AAA', 'minor',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Fifth Third Field', 'outdoor',
    'https://www.milb.com/toledo/tickets/promotions',
    'toledo-mud-hens'),
  ('Erie SeaWolves', 'SeaWolves', 'ERI', 'MiLB-AA', 'minor',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'UPMC Park', 'outdoor',
    'https://www.milb.com/erie/tickets/promotions',
    'erie-seawolves'),
  ('Grand Rapids Griffins', 'Griffins', 'GR', 'AHL', 'minor',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Van Andel Arena', 'indoor',
    'https://www.griffinshockey.com/promotions',
    'grand-rapids-griffins'),
  ('Detroit City FC', 'DCFC', 'DCFC', 'USL', 'minor',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Keyworth Stadium', 'outdoor',
    'https://www.detcityfc.com/promotions',
    'detroit-city-fc')
ON CONFLICT DO NOTHING;

-- Portland teams
INSERT INTO teams (name, short_name, abbreviation, league, league_level, city_id, venue_name, venue_type, promo_page_url, seatgeek_slug)
VALUES
  ('Portland Trail Blazers', 'Trail Blazers', 'POR', 'NBA', 'major',
    (SELECT id FROM cities WHERE name = 'Portland'),
    'Moda Center', 'indoor',
    'https://www.nba.com/blazers/tickets/promotions',
    'portland-trail-blazers'),
  ('Portland Timbers', 'Timbers', 'POR', 'MLS', 'major',
    (SELECT id FROM cities WHERE name = 'Portland'),
    'Providence Park', 'outdoor',
    'https://www.timbers.com/tickets/promotions',
    'portland-timbers'),
  ('Portland Thorns FC', 'Thorns', 'POR', 'NWSL', 'major',
    (SELECT id FROM cities WHERE name = 'Portland'),
    'Providence Park', 'outdoor',
    'https://www.thornsfc.com/tickets/promotions',
    'portland-thorns-fc'),
  ('Hillsboro Hops', 'Hops', 'HB', 'MiLB-A+', 'minor',
    (SELECT id FROM cities WHERE name = 'Portland'),
    'Ron Tonkin Field', 'outdoor',
    'https://www.milb.com/hillsboro/tickets/promotions',
    'hillsboro-hops'),
  ('Portland Winterhawks', 'Winterhawks', 'POR', 'WHL', 'minor',
    (SELECT id FROM cities WHERE name = 'Portland'),
    'Veterans Memorial Coliseum', 'indoor',
    'https://winterhawks.com/promotions',
    'portland-winterhawks')
ON CONFLICT DO NOTHING;
