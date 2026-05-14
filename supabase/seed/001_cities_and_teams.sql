-- Seed data: Cities and Teams for MVP (Detroit + Portland)

-- ============================================================
-- CITIES
-- ============================================================

INSERT INTO cities (name, state, timezone, is_active) VALUES
  ('Detroit', 'MI', 'America/Detroit', true),
  ('Portland', 'OR', 'America/Los_Angeles', true),
  -- "External" is a permanent placeholder for away teams whose markets we don't cover.
  -- teams.city_id is NOT NULL, so any away team we track standings for (e.g. Lakers,
  -- Thunder, Cavs) needs *some* city. They go here, NOT in an MVP city — otherwise
  -- ESPN ingestion picks them up as home games for that city. is_active=false means
  -- runFullPipeline never iterates them.
  ('External', '', 'America/New_York', false)
ON CONFLICT (name, state) DO NOTHING;

-- ============================================================
-- DETROIT TEAMS
-- ============================================================

-- Major leagues
INSERT INTO teams (name, short_name, abbreviation, league, league_level, city_id, venue_name, venue_type, promo_page_url, seatgeek_slug)
VALUES
  ('Detroit Tigers', 'Tigers', 'DET', 'MLB', 'major',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Comerica Park', 'outdoor',
    'https://www.mlb.com/tigers/tickets/promotions/giveaways,https://www.mlb.com/tigers/tickets/specials/events',
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
    'detroit-red-wings')
ON CONFLICT DO NOTHING;

-- Minor leagues
INSERT INTO teams (name, short_name, abbreviation, league, league_level, city_id, venue_name, venue_type, promo_page_url, seatgeek_slug)
VALUES
  ('Toledo Mud Hens', 'Mud Hens', 'TOL', 'MiLB-AAA', 'minor',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'Fifth Third Field', 'outdoor',
    'https://www.milb.com/toledo/tickets/promotions,https://www.milb.com/toledo/tickets/giveaways',
    'toledo-mud-hens'),
  ('Erie SeaWolves', 'SeaWolves', 'ERI', 'MiLB-AA', 'minor',
    (SELECT id FROM cities WHERE name = 'Detroit'),
    'UPMC Park', 'outdoor',
    'https://www.milb.com/erie/tickets/promotions,https://www.milb.com/erie/tickets/theme-nights',
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

-- ============================================================
-- PORTLAND TEAMS
-- ============================================================

-- Major leagues
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
    'https://www.timbers.com/news/portland-timbers-announce-2026-theme-nights-schedule',
    'portland-timbers'),
  ('Portland Thorns FC', 'Thorns', 'POR', 'NWSL', 'major',
    (SELECT id FROM cities WHERE name = 'Portland'),
    'Providence Park', 'outdoor',
    'https://www.thorns.com/thorns-promotional-schedule',
    'portland-thorns-fc'),
  ('Portland Fire', 'Fire', 'POR', 'WNBA', 'major',
    (SELECT id FROM cities WHERE name = 'Portland'),
    'Moda Center', 'indoor',
    'https://fire.wnba.com/promotional-schedule',
    'portland-fire')
ON CONFLICT DO NOTHING;

-- Minor leagues
INSERT INTO teams (name, short_name, abbreviation, league, league_level, city_id, venue_name, venue_type, promo_page_url, seatgeek_slug)
VALUES
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
