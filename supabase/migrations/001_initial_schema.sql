-- GameDay MVP Database Schema
-- Automation-first sports game recommendation engine

-- ============================================================
-- CITIES & TEAMS (reference data)
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
  name TEXT NOT NULL,              -- e.g. "Detroit Tigers"
  short_name TEXT NOT NULL,        -- e.g. "Tigers"
  abbreviation TEXT,               -- e.g. "DET"
  league TEXT NOT NULL,            -- e.g. "MLB", "NBA", "NHL", "MLS", "USL", "AHL"
  league_level TEXT NOT NULL DEFAULT 'major', -- "major" or "minor"
  city_id UUID NOT NULL REFERENCES cities(id),
  venue_name TEXT,
  venue_type TEXT,                 -- "indoor" or "outdoor"
  logo_url TEXT,
  promo_page_url TEXT,             -- official team promotions page for scraping
  seatgeek_slug TEXT,              -- for API integration
  external_ids JSONB DEFAULT '{}', -- store IDs from various APIs
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_city ON teams(city_id);
CREATE INDEX idx_teams_league ON teams(league);

-- ============================================================
-- GAMES
-- ============================================================

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
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, live, final, postponed, cancelled
  source TEXT NOT NULL DEFAULT 'api',       -- api, manual, scrape
  source_event_id TEXT,                     -- external API event ID
  affiliate_url TEXT,
  is_featured BOOLEAN NOT NULL DEFAULT false,  -- admin can force-feature
  is_hidden BOOLEAN NOT NULL DEFAULT false,    -- admin can hide
  is_published BOOLEAN NOT NULL DEFAULT true,
  pipeline_status TEXT NOT NULL DEFAULT 'pending', -- pending, enriched, reviewed, published
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_event_id, source)
);

CREATE INDEX idx_games_city_start ON games(city_id, start_time);
CREATE INDEX idx_games_start_time ON games(start_time);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_pipeline ON games(pipeline_status);

-- ============================================================
-- PRICING SNAPSHOTS
-- ============================================================

CREATE TABLE pricing_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,           -- "seatgeek", "ticketmaster", "stubhub"
  lowest_price NUMERIC(10,2),
  avg_price NUMERIC(10,2),
  median_price NUMERIC(10,2),
  -- Pricing transparency fields
  displayed_price NUMERIC(10,2),       -- what we show the user
  base_price NUMERIC(10,2),
  mandatory_fees NUMERIC(10,2),
  estimated_tax NUMERIC(10,2),
  pricing_transparency TEXT NOT NULL DEFAULT 'base_price_only',
    -- all_in_verified, estimated_with_fees, base_price_only
  affiliate_url TEXT,
  listing_count INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pricing_game ON pricing_snapshots(game_id);
CREATE INDEX idx_pricing_captured ON pricing_snapshots(captured_at);

-- ============================================================
-- PROMOTIONS
-- ============================================================

CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  source_url TEXT,
  raw_text TEXT,                        -- scraped text from promo page
  promo_type TEXT,                      -- giveaway, theme_night, fireworks, special_ticket, family_promo, food_bev_promo
  promo_item TEXT,                      -- e.g. "bobblehead", "free hot dog"
  promo_description TEXT,               -- clean description
  special_ticket_required BOOLEAN DEFAULT false,
  eligibility_details TEXT,             -- e.g. "first 10,000 fans"
  promo_clarity TEXT,                   -- AI-enhanced practical guidance
  confidence_score NUMERIC(3,2) DEFAULT 0.0, -- 0.00 to 1.00
  is_ai_extracted BOOLEAN NOT NULL DEFAULT false,
  is_admin_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_promotions_game ON promotions(game_id);

-- ============================================================
-- SCORES
-- ============================================================

CREATE TABLE scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  price_score NUMERIC(4,2) DEFAULT 0,       -- 0-10
  experience_score NUMERIC(4,2) DEFAULT 0,  -- 0-10
  game_quality_score NUMERIC(4,2) DEFAULT 0,-- 0-10
  timing_score NUMERIC(4,2) DEFAULT 0,      -- 0-10
  context_score NUMERIC(4,2) DEFAULT 0,     -- 0-10
  deal_score NUMERIC(4,2) DEFAULT 0,        -- 0-10 (weighted composite)
  reasoning_summary TEXT,
  score_breakdown JSONB DEFAULT '{}',        -- detailed breakdown for transparency
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_id)
);

CREATE INDEX idx_scores_deal ON scores(deal_score DESC);

-- ============================================================
-- TAGS
-- ============================================================

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  tag_name TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'ai', -- ai, admin, rule
  confidence_score NUMERIC(3,2) DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_id, tag_name)
);

CREATE INDEX idx_tags_game ON tags(game_id);

-- ============================================================
-- GAME INSIGHTS (Fan Decision Intelligence)
-- ============================================================

CREATE TABLE game_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  expectation_summary TEXT,
  target_audience TEXT[] DEFAULT '{}',      -- array of audience types
  effort_level TEXT DEFAULT 'moderate',     -- easy, moderate, high_effort
  price_insight TEXT,
  promo_clarity TEXT,
  seat_expectation TEXT,
  context_flags TEXT[] DEFAULT '{}',
  verdict TEXT,                              -- THE key one-sentence verdict
  why_worth_it TEXT,                         -- "why it's worth it" sentence
  confidence_score NUMERIC(3,2) DEFAULT 0.0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(game_id)
);

CREATE INDEX idx_insights_game ON game_insights(game_id);

-- ============================================================
-- ADMIN OVERRIDES (audit trail)
-- ============================================================

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

-- ============================================================
-- PIPELINE RUNS (tracking automation health)
-- ============================================================

CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL,              -- full, events_only, pricing_only, promos_only, enrichment_only
  city_id UUID REFERENCES cities(id),
  status TEXT NOT NULL DEFAULT 'running', -- running, completed, failed, partial
  games_found INTEGER DEFAULT 0,
  games_enriched INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- UPDATED_AT TRIGGER
-- ============================================================

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
