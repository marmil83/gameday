-- 2026 FIFA World Cup seed — only matches hosted at MetLife (NY/NJ) and
-- SoFi (LA). The schema doesn't naturally model international tournaments
-- (teams.city_id is NOT NULL, league strings expect US pro leagues), so
-- this is a deliberate special case rather than a generic refactor:
--
--   • A "World" placeholder city (is_active=false → never appears in the
--     city nav) holds all national-team rows.
--   • National-team rows are full teams.* rows with logo_url pointing at
--     flagcdn.com (free CDN; 2-letter ISO codes; gb-eng for England).
--   • A shared "TBD" team row carries every knockout-bracket placeholder.
--     The display string ("Winner Match 76", "Runner-up Group A", …) lives
--     in the games row's home/away_team_name; the team_id is just a valid
--     FK so the NOT NULL constraint holds.
--   • For each match we ALSO pre-seed scores, game_insights, and tags
--     because there's no pipeline path that can score a national-team
--     game — the deal-score logic depends on team standings, recent-form,
--     league averages, etc., none of which exist for nationals. Hand-tuned
--     values are good enough for v1 and consistent with the brand voice.
--
-- IDEMPOTENCY: this seed is meant to be run once. If you need to re-run,
-- delete the rows manually first (cleanest path: DELETE FROM games WHERE
-- source = 'manual-wc-2026'; cascades to scores/insights/tags/snapshots).

-- ============================================================
-- 1) CITY + TEAMS
-- ============================================================

INSERT INTO cities (name, state, timezone, is_active) VALUES
  ('World', '', 'UTC', false)
ON CONFLICT (name, state) DO NOTHING;

-- National teams competing at MetLife or SoFi. Logos use flagcdn.com
-- (320px PNGs, transparent backgrounds, render cleanly on dark cards).
INSERT INTO teams (name, short_name, abbreviation, league, league_level, city_id, venue_name, venue_type, logo_url)
VALUES
  ('Brazil',       'Brazil',  'BRA',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/br.png'),
  ('Morocco',      'Morocco', 'MAR',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/ma.png'),
  ('France',       'France',  'FRA',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/fr.png'),
  ('Senegal',      'Senegal', 'SEN',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/sn.png'),
  ('Norway',       'Norway',  'NOR',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/no.png'),
  ('Ecuador',      'Ecuador', 'ECU',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/ec.png'),
  ('Germany',      'Germany', 'GER',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/de.png'),
  ('Panama',       'Panama',  'PAN',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/pa.png'),
  ('England',      'England', 'ENG',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/gb-eng.png'),
  ('USA',          'USA',     'USA',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/us.png'),
  ('Paraguay',     'Paraguay','PAR',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/py.png'),
  ('Iran',         'Iran',    'IRN',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/ir.png'),
  ('New Zealand',  'NZ',      'NZL',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/nz.png'),
  ('Switzerland',  'Swiss',   'SUI',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/ch.png'),
  ('Belgium',      'Belgium', 'BEL',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', 'https://flagcdn.com/w320/be.png'),
  -- Single placeholder used for every bracket position that isn't yet
  -- resolved (knockouts, Euro play-off winners). The display string
  -- ("Winner Match 76", "Euro Play-off Winner A", …) lives in the games
  -- row's *_team_name column; this row exists only so the *_team_id FK
  -- has a target. Logo intentionally null so the card renders without a
  -- flag rather than showing a wrong country.
  ('FIFA WC TBD',  'TBD',     'TBD',  'FIFA-WC', 'major', (SELECT id FROM cities WHERE name='World'), 'Various', 'outdoor', NULL)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2) GAMES — MetLife Stadium (NY/NJ)
-- ============================================================
-- Eastern times converted to UTC: ET = UTC-4 in summer (EDT).
-- 18:00 ET = 22:00 UTC; 15:00 ET = 19:00 UTC; 20:00 ET = 00:00 UTC next day;
-- 16:00 ET = 20:00 UTC; 17:00 ET = 21:00 UTC.
-- NOTE on home/away: WC has no real home/away. We put the MARQUEE team
-- (the more storied / bigger draw) in home_team to drive which flag and
-- name lead the card; the card swaps "@" → "vs" for league=FIFA-WC, so
-- "USA vs Paraguay" reads naturally regardless.

INSERT INTO games (
  home_team_id, away_team_id, home_team_name, away_team_name,
  league, venue, city_id, start_time, status, source, source_event_id,
  is_home_game, is_featured, pipeline_status
) VALUES
  -- M07 · Brazil vs Morocco · Group C · Sat Jun 13, 6 PM ET
  ((SELECT id FROM teams WHERE name='Brazil'),  (SELECT id FROM teams WHERE name='Morocco'),
   'Brazil', 'Morocco', 'FIFA-WC', 'MetLife Stadium',
   (SELECT id FROM cities WHERE name='New York'),
   '2026-06-13 22:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m07',
   true, true, 'enriched'),

  -- M17 · France vs Senegal · Group I · Tue Jun 16, 3 PM ET
  ((SELECT id FROM teams WHERE name='France'),  (SELECT id FROM teams WHERE name='Senegal'),
   'France', 'Senegal', 'FIFA-WC', 'MetLife Stadium',
   (SELECT id FROM cities WHERE name='New York'),
   '2026-06-16 19:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m17',
   true, true, 'enriched'),

  -- M41 · Norway vs Senegal · Group I · Mon Jun 22, 8 PM ET
  ((SELECT id FROM teams WHERE name='Norway'),  (SELECT id FROM teams WHERE name='Senegal'),
   'Norway', 'Senegal', 'FIFA-WC', 'MetLife Stadium',
   (SELECT id FROM cities WHERE name='New York'),
   '2026-06-23 00:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m41',
   true, true, 'enriched'),

  -- M56 · Germany vs Ecuador · Group E · Thu Jun 25, 4 PM ET
  -- (FIFA bracket has Ecuador as Team 1; flipping for marquee.)
  ((SELECT id FROM teams WHERE name='Germany'), (SELECT id FROM teams WHERE name='Ecuador'),
   'Germany', 'Ecuador', 'FIFA-WC', 'MetLife Stadium',
   (SELECT id FROM cities WHERE name='New York'),
   '2026-06-25 20:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m56',
   true, true, 'enriched'),

  -- M67 · England vs Panama · Group L · Sat Jun 27, 5 PM ET
  -- (FIFA bracket has Panama as Team 1; flipping for marquee.)
  ((SELECT id FROM teams WHERE name='England'), (SELECT id FROM teams WHERE name='Panama'),
   'England', 'Panama', 'FIFA-WC', 'MetLife Stadium',
   (SELECT id FROM cities WHERE name='New York'),
   '2026-06-27 21:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m67',
   true, true, 'enriched'),

  -- M77 · Round of 32 · Tue Jun 30, 5 PM ET
  ((SELECT id FROM teams WHERE name='FIFA WC TBD'), (SELECT id FROM teams WHERE name='FIFA WC TBD'),
   'TBD', 'TBD', 'FIFA-WC', 'MetLife Stadium',
   (SELECT id FROM cities WHERE name='New York'),
   '2026-06-30 21:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m77',
   true, true, 'enriched'),

  -- M91 · Round of 16 · Sun Jul 5, 4 PM ET
  ((SELECT id FROM teams WHERE name='FIFA WC TBD'), (SELECT id FROM teams WHERE name='FIFA WC TBD'),
   'Winner Match 76', 'Winner Match 78', 'FIFA-WC', 'MetLife Stadium',
   (SELECT id FROM cities WHERE name='New York'),
   '2026-07-05 20:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m91',
   true, true, 'enriched'),

  -- M104 · FINAL · Sun Jul 19, 3 PM ET
  ((SELECT id FROM teams WHERE name='FIFA WC TBD'), (SELECT id FROM teams WHERE name='FIFA WC TBD'),
   'Winner Match 101', 'Winner Match 102', 'FIFA-WC', 'MetLife Stadium',
   (SELECT id FROM cities WHERE name='New York'),
   '2026-07-19 19:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m104',
   true, true, 'enriched'),

-- ============================================================
-- GAMES — SoFi Stadium (LA)
-- ============================================================
-- Pacific times converted to UTC: PT = UTC-7 in summer (PDT).
-- 18:00 PT = 01:00 UTC next day; 12:00 PT = 19:00 UTC; 19:00 PT = 02:00 UTC next day.

  -- M04 · USA vs Paraguay · Group D · Fri Jun 12, 6 PM PT
  ((SELECT id FROM teams WHERE name='USA'),         (SELECT id FROM teams WHERE name='Paraguay'),
   'USA', 'Paraguay', 'FIFA-WC', 'SoFi Stadium',
   (SELECT id FROM cities WHERE name='Los Angeles'),
   '2026-06-13 01:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m04',
   true, true, 'enriched'),

  -- M15 · Iran vs New Zealand · Group G · Mon Jun 15, 6 PM PT
  ((SELECT id FROM teams WHERE name='Iran'),        (SELECT id FROM teams WHERE name='New Zealand'),
   'Iran', 'New Zealand', 'FIFA-WC', 'SoFi Stadium',
   (SELECT id FROM cities WHERE name='Los Angeles'),
   '2026-06-16 01:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m15',
   true, true, 'enriched'),

  -- M26 · Switzerland vs Euro Play-off Winner A · Group B · Thu Jun 18, 12 PM PT
  ((SELECT id FROM teams WHERE name='Switzerland'), (SELECT id FROM teams WHERE name='FIFA WC TBD'),
   'Switzerland', 'Euro Play-off Winner A', 'FIFA-WC', 'SoFi Stadium',
   (SELECT id FROM cities WHERE name='Los Angeles'),
   '2026-06-18 19:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m26',
   true, true, 'enriched'),

  -- M39 · Belgium vs Iran · Group G · Sun Jun 21, 12 PM PT
  ((SELECT id FROM teams WHERE name='Belgium'),     (SELECT id FROM teams WHERE name='Iran'),
   'Belgium', 'Iran', 'FIFA-WC', 'SoFi Stadium',
   (SELECT id FROM cities WHERE name='Los Angeles'),
   '2026-06-21 19:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m39',
   true, true, 'enriched'),

  -- M59 · USA vs Euro Play-off Winner C · Group D · Thu Jun 25, 7 PM PT
  -- (FIFA bracket has PO Winner as Team 1; flipping for marquee.)
  ((SELECT id FROM teams WHERE name='USA'),         (SELECT id FROM teams WHERE name='FIFA WC TBD'),
   'USA', 'Euro Play-off Winner C', 'FIFA-WC', 'SoFi Stadium',
   (SELECT id FROM cities WHERE name='Los Angeles'),
   '2026-06-26 02:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m59',
   true, true, 'enriched'),

  -- M73 · Round of 32 · Sun Jun 28, 12 PM PT
  ((SELECT id FROM teams WHERE name='FIFA WC TBD'), (SELECT id FROM teams WHERE name='FIFA WC TBD'),
   'Runner-up Group A', 'Runner-up Group B', 'FIFA-WC', 'SoFi Stadium',
   (SELECT id FROM cities WHERE name='Los Angeles'),
   '2026-06-28 19:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m73',
   true, true, 'enriched'),

  -- M84 · Round of 32 · Thu Jul 2, 12 PM PT
  ((SELECT id FROM teams WHERE name='FIFA WC TBD'), (SELECT id FROM teams WHERE name='FIFA WC TBD'),
   'Winner Group H', 'Runner-up Group J', 'FIFA-WC', 'SoFi Stadium',
   (SELECT id FROM cities WHERE name='Los Angeles'),
   '2026-07-02 19:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m84',
   true, true, 'enriched'),

  -- M98 · Quarterfinal · Fri Jul 10, 12 PM PT
  ((SELECT id FROM teams WHERE name='FIFA WC TBD'), (SELECT id FROM teams WHERE name='FIFA WC TBD'),
   'Winner Match 93', 'Winner Match 94', 'FIFA-WC', 'SoFi Stadium',
   (SELECT id FROM cities WHERE name='Los Angeles'),
   '2026-07-10 19:00:00+00', 'scheduled', 'manual-wc-2026', 'fifa-wc-m98',
   true, true, 'enriched')

ON CONFLICT (source_event_id, source) DO NOTHING;

-- ============================================================
-- 3) SCORES — hand-tuned per match
-- ============================================================
-- WC is a special beast for the deal-score formula:
--   price_score        = 0.4 weight — tickets are expensive; low score
--                                     for finals, slightly higher for group
--   experience_score   = 0.2 weight — always near-max (it's the World Cup)
--   game_quality_score = 0.2 weight — by stage (final > QF > R16 > R32 > group)
--                                     with bumps for marquee teams
--   timing_score       = 0.1 weight — slight bump for weekends/primetime
--   context_score      = 0.1 weight — always max (once-in-a-lifetime)
-- Composite "deal_score" hand-computed and locked here so the pipeline's
-- rules-based scorer doesn't fight us if it ever runs over these rows.

INSERT INTO scores (
  game_id, price_score, experience_score, game_quality_score,
  timing_score, context_score, deal_score, reasoning_summary, score_breakdown
)
SELECT g.id, s.price_score, s.experience_score, s.game_quality_score,
       s.timing_score, s.context_score, s.deal_score, s.reasoning_summary,
       s.score_breakdown::jsonb
FROM (VALUES
  -- (source_event_id, price, exp, quality, timing, context, deal, summary, breakdown)
  ('fifa-wc-m07',  3.5, 9.5, 8.5, 9.0, 10.0, 7.2,
   'Brazil at MetLife on a Saturday primetime is a near-perfect group stage matchup. Expensive but unforgettable.',
   '{"price":{"score":3.5,"reasoning":"Premium pricing for a Brazil group stage match"},"experience":{"score":9.5,"reasoning":"World Cup at MetLife"},"quality":{"score":8.5,"reasoning":"Brazil is the marquee"}}'),

  ('fifa-wc-m17',  3.5, 9.5, 8.5, 8.0, 10.0, 7.1,
   'France vs Senegal is a heavyweight group stage clash. Tuesday afternoon kickoff at premium prices.',
   '{"price":{"score":3.5,"reasoning":"Premium WC pricing"},"experience":{"score":9.5,"reasoning":"World Cup at MetLife"},"quality":{"score":8.5,"reasoning":"Mbappe era France"}}'),

  ('fifa-wc-m41',  3.5, 9.5, 8.0, 7.5, 10.0, 7.0,
   'Haaland''s first World Cup at MetLife — Monday primetime, premium pricing.',
   '{"price":{"score":3.5,"reasoning":"WC group MD2 pricing"},"experience":{"score":9.5,"reasoning":"World Cup at MetLife"},"quality":{"score":8.0,"reasoning":"Norway debut with Haaland"}}'),

  ('fifa-wc-m56',  3.5, 9.5, 8.0, 8.0, 10.0, 7.1,
   'Germany trying to lock the group — Thursday late afternoon at MetLife.',
   '{"price":{"score":3.5,"reasoning":"Premium WC pricing"},"experience":{"score":9.5,"reasoning":"World Cup at MetLife"},"quality":{"score":8.0,"reasoning":"Germany marquee"}}'),

  ('fifa-wc-m67',  3.5, 9.5, 8.0, 9.0, 10.0, 7.2,
   'England''s final group game at MetLife — Saturday at the highest stakes of group stage.',
   '{"price":{"score":3.5,"reasoning":"Premium WC pricing"},"experience":{"score":9.5,"reasoning":"World Cup at MetLife"},"quality":{"score":8.0,"reasoning":"England marquee, MD3 stakes"}}'),

  ('fifa-wc-m77',  3.0, 9.8, 8.5, 8.0, 10.0, 7.2,
   'First knockout at MetLife. Tuesday primetime. One team goes home — that''s the deal.',
   '{"price":{"score":3.0,"reasoning":"Knockout premium"},"experience":{"score":9.8,"reasoning":"First MetLife knockout"},"quality":{"score":8.5,"reasoning":"Round of 32 stakes"}}'),

  ('fifa-wc-m91',  2.5, 10.0, 9.0, 9.5, 10.0, 7.5,
   'Round of 16 at MetLife on a Sunday. The field cuts in half. Lock it in if you can.',
   '{"price":{"score":2.5,"reasoning":"R16 premium"},"experience":{"score":10.0,"reasoning":"Sunday R16 at MetLife"},"quality":{"score":9.0,"reasoning":"Top 16 in the world"}}'),

  ('fifa-wc-m104', 1.5, 10.0, 10.0, 10.0, 10.0, 7.5,
   'The Final. At MetLife. On a Sunday afternoon. There is no bigger ticket on Earth — and the price reflects it.',
   '{"price":{"score":1.5,"reasoning":"Final pricing — top of the market"},"experience":{"score":10.0,"reasoning":"The Final"},"quality":{"score":10.0,"reasoning":"The two best teams left"}}'),

  ('fifa-wc-m04',  4.0, 9.5, 8.5, 9.5, 10.0, 7.5,
   'USA opens the tournament at SoFi on a Friday night. Stars and stripes energy. Easy yes.',
   '{"price":{"score":4.0,"reasoning":"Opening match pricing"},"experience":{"score":9.5,"reasoning":"USA opener at SoFi"},"quality":{"score":8.5,"reasoning":"USA marquee, opening match buzz"}}'),

  ('fifa-wc-m15',  4.5, 9.0, 6.5, 7.0, 10.0, 6.7,
   'Iran vs NZ at SoFi — mid group matchup, Monday primetime. Solid if you can swing it.',
   '{"price":{"score":4.5,"reasoning":"Cheaper end of WC pricing"},"experience":{"score":9.0,"reasoning":"World Cup at SoFi"},"quality":{"score":6.5,"reasoning":"Lower-tier group matchup"}}'),

  ('fifa-wc-m26',  4.0, 9.0, 7.0, 7.5, 10.0, 6.8,
   'Switzerland is a sneaky team, opponent is TBD play-off winner. Daytime SoFi football.',
   '{"price":{"score":4.0,"reasoning":"Group MD2 pricing"},"experience":{"score":9.0,"reasoning":"World Cup at SoFi"},"quality":{"score":7.0,"reasoning":"Switzerland is dangerous"}}'),

  ('fifa-wc-m39',  3.5, 9.5, 8.0, 8.5, 10.0, 7.2,
   'Belgium with De Bruyne at SoFi on a Sunday matinee. Premium pricing, premium opponent.',
   '{"price":{"score":3.5,"reasoning":"Premium WC pricing"},"experience":{"score":9.5,"reasoning":"World Cup at SoFi"},"quality":{"score":8.0,"reasoning":"Belgium marquee"}}'),

  ('fifa-wc-m59',  3.5, 9.5, 8.5, 9.0, 10.0, 7.3,
   'USA''s last group game at SoFi — Thursday primetime, knockout vibes already.',
   '{"price":{"score":3.5,"reasoning":"Premium WC pricing"},"experience":{"score":9.5,"reasoning":"USA at SoFi"},"quality":{"score":8.5,"reasoning":"USA must-win"}}'),

  ('fifa-wc-m73',  3.0, 9.8, 8.5, 8.5, 10.0, 7.3,
   'First knockout at SoFi. Sunday matinee. Tournament officially starts here.',
   '{"price":{"score":3.0,"reasoning":"R32 premium"},"experience":{"score":9.8,"reasoning":"First SoFi knockout"},"quality":{"score":8.5,"reasoning":"R32 stakes"}}'),

  ('fifa-wc-m84',  3.0, 9.8, 8.5, 8.0, 10.0, 7.2,
   'Second SoFi knockout. Group winners get tested. Thursday daytime.',
   '{"price":{"score":3.0,"reasoning":"R32 premium"},"experience":{"score":9.8,"reasoning":"SoFi knockout"},"quality":{"score":8.5,"reasoning":"R32 stakes"}}'),

  ('fifa-wc-m98',  2.0, 10.0, 9.5, 9.5, 10.0, 7.5,
   'Quarterfinal at SoFi. Final 8. Friday matinee, world watching.',
   '{"price":{"score":2.0,"reasoning":"QF premium"},"experience":{"score":10.0,"reasoning":"QF at SoFi"},"quality":{"score":9.5,"reasoning":"Final 8 stakes"}}')
) AS s(source_event_id, price_score, experience_score, game_quality_score,
       timing_score, context_score, deal_score, reasoning_summary, score_breakdown)
JOIN games g ON g.source_event_id = s.source_event_id AND g.source = 'manual-wc-2026'
ON CONFLICT (game_id) DO NOTHING;

-- ============================================================
-- 4) GAME INSIGHTS — hand-written in brand voice
-- ============================================================
-- context_flags drive the colored callout above the team name. Stages:
--   wc-final         → "Final" (deep red)
--   wc-quarterfinal  → "Quarterfinal" (red)
--   wc-round-of-16   → "Round of 16" (orange-red)
--   wc-round-of-32   → "Round of 32" (orange)
--   wc-group         → "Group Stage" (purple)
-- Group / knockout matters more than the matchup label here — the venue's
-- league eyebrow already says "WORLD CUP" via the FIFA-WC league code.

INSERT INTO game_insights (
  game_id, verdict, why_worth_it, expectation_summary,
  target_audience, effort_level, price_insight, seat_expectation,
  context_flags, confidence_score
)
SELECT g.id, i.verdict, i.why_worth_it, i.expectation_summary,
       i.target_audience, i.effort_level, i.price_insight, i.seat_expectation,
       i.context_flags, i.confidence_score
FROM (VALUES
  ('fifa-wc-m07',
   'Brazil at MetLife on a Saturday primetime. Lock it in if you can swing it.',
   'Selecao''s tournament opener in NY — first look at whether this group has Final energy or just samba and vibes. MetLife will be 80,000 strong.',
   'Sold-out feel, Brazilian crowd dominant, samba drums and yellow shirts everywhere.',
   ARRAY['hardcore fans','social outing']::TEXT[], 'high_effort',
   'Premium pricing — this is Brazil at MetLife, sticker shock is real.',
   'Upper bowl unless you''re going big.',
   ARRAY['wc-group']::TEXT[], 0.95),

  ('fifa-wc-m17',
   'France in the city. Pay up and go.',
   'Mbappe era France vs a feisty Senegal — group stage rarely gets this loaded. Tuesday daytime kickoff at MetLife means you''re home in time for dinner.',
   'World-class football, mixed crowd with strong French and Senegalese support.',
   ARRAY['hardcore fans','social outing']::TEXT[], 'high_effort',
   'Premium pricing for a heavyweight group matchup.',
   'Upper deck for entry pricing.',
   ARRAY['wc-group']::TEXT[], 0.95),

  ('fifa-wc-m41',
   'Haaland at MetLife on a Monday primetime. Honestly worth it just for that.',
   'Norway''s first World Cup since ''98 plus Senegal trying to keep their dream alive. One of the most electric strikers in the game, in person.',
   'Norway fans traveling deep, primetime atmosphere.',
   ARRAY['hardcore fans']::TEXT[], 'high_effort',
   'Premium pricing — Haaland tax is real.',
   'Upper bowl for entry; midfield lower if you push the budget.',
   ARRAY['wc-group']::TEXT[], 0.92),

  ('fifa-wc-m56',
   'Germany at MetLife is the move.',
   'Die Mannschaft trying to lock up the group — Ecuador won''t roll over. Late-afternoon kickoff, beers at the tailgate after.',
   'Heavy German support, classic WC group atmosphere.',
   ARRAY['hardcore fans','social outing']::TEXT[], 'high_effort',
   'Premium pricing.',
   'Upper bowl for entry.',
   ARRAY['wc-group']::TEXT[], 0.92),

  ('fifa-wc-m67',
   'England''s last group game in NY. Big crowd, big stakes.',
   'Three Lions probably need a result to advance — Saturday afternoon at MetLife and the away support will be cooking.',
   'Big English contingent, classic Saturday afternoon WC vibes.',
   ARRAY['hardcore fans','social outing']::TEXT[], 'high_effort',
   'Premium pricing, especially for England.',
   'Upper deck unless you go big.',
   ARRAY['wc-group']::TEXT[], 0.94),

  ('fifa-wc-m77',
   'Knockout football at MetLife. The teams aren''t decided yet but the stakes are.',
   'First time MetLife hosts a knockout match. Whoever lands here, one team goes home — that''s the whole deal.',
   'Sold out regardless of who shows up. Knockout intensity.',
   ARRAY['hardcore fans']::TEXT[], 'high_effort',
   'Knockout premium — the price doesn''t care who plays.',
   'Upper bowl.',
   ARRAY['wc-round-of-32']::TEXT[], 0.85),

  ('fifa-wc-m91',
   'Sweet 16 of the world. Lock it in.',
   'The field cuts in half — whoever survives Round of 32 goes head-to-head on a Sunday at MetLife.',
   'Massive atmosphere, knockout do-or-die energy.',
   ARRAY['hardcore fans','social outing']::TEXT[], 'high_effort',
   'R16 pricing — steep but defensible for the stakes.',
   'Upper deck for entry, midfield for the experience.',
   ARRAY['wc-round-of-16']::TEXT[], 0.85),

  ('fifa-wc-m104',
   'It''s the Final. Don''t overthink it.',
   'The biggest soccer game of the next four years is in NJ. Whoever''s left has earned it. So have you, if you go.',
   'The Final. There is nothing bigger on the calendar.',
   ARRAY['hardcore fans']::TEXT[], 'high_effort',
   'Top of the market — you''re paying for a memory, not a deal.',
   'Whatever you can afford. There are no bad seats.',
   ARRAY['wc-final']::TEXT[], 0.99),

  ('fifa-wc-m04',
   'USA opener in LA. Easy yes.',
   'Stars and stripes kick off the tournament at SoFi on a Friday night — opening-game atmosphere is a different beast.',
   'Sea of red white and blue, opening-match buzz.',
   ARRAY['hardcore fans','casual fans','social outing']::TEXT[], 'high_effort',
   'Premium pricing for an opener — book early if you''re going.',
   'Upper bowl for entry, lower for the experience.',
   ARRAY['wc-group']::TEXT[], 0.95),

  ('fifa-wc-m15',
   'Group stage at SoFi — solid pick if your night''s free.',
   'Iran brings real away support; New Zealand is the underdog you root for. Monday night in Inglewood.',
   'Smaller crowd than a marquee match but still proper WC atmosphere.',
   ARRAY['casual fans','social outing']::TEXT[], 'moderate',
   'On the cheaper end of WC pricing — solid value for the tournament.',
   'Plenty of lower-bowl availability at entry pricing.',
   ARRAY['wc-group']::TEXT[], 0.85),

  ('fifa-wc-m26',
   'Daytime World Cup at SoFi. Why not.',
   'Switzerland is a quiet danger and the play-off winner shows up with everything to prove. Beat the heat, sit in the shade, enjoy.',
   'Lunch-hour crowd, mellow but engaged.',
   ARRAY['casual fans','social outing']::TEXT[], 'moderate',
   'Mid-range WC pricing.',
   'Lower bowl on the shaded side is the move.',
   ARRAY['wc-group']::TEXT[], 0.82),

  ('fifa-wc-m39',
   'De Bruyne energy in LA. Sunday matinee.',
   'Belgium''s loaded again, Iran will make them earn it. SoFi crowd, lunch kickoff, classic group stage chaos.',
   'Heavy Belgian and Iranian crowds — atmosphere will be loud.',
   ARRAY['hardcore fans','social outing']::TEXT[], 'high_effort',
   'Premium pricing for a Belgium match.',
   'Upper bowl entry.',
   ARRAY['wc-group']::TEXT[], 0.92),

  ('fifa-wc-m59',
   'USA''s last group game. Knockout vibes already.',
   'Win and walk through. Lose and the dream gets complicated. Thursday primetime at SoFi is going to be loud.',
   'Stars and stripes everywhere, do-or-die energy.',
   ARRAY['hardcore fans','casual fans','social outing']::TEXT[], 'high_effort',
   'Premium pricing — USA in a must-win.',
   'Upper deck for entry, lower for the moment.',
   ARRAY['wc-group']::TEXT[], 0.95),

  ('fifa-wc-m73',
   'First knockout at SoFi. Don''t blink.',
   'Two surviving group teams — the tournament officially starts here. Sunday matinee, beer, vibes.',
   'Sold out. Knockout intensity.',
   ARRAY['hardcore fans']::TEXT[], 'high_effort',
   'Knockout premium.',
   'Upper bowl.',
   ARRAY['wc-round-of-32']::TEXT[], 0.85),

  ('fifa-wc-m84',
   'Second SoFi knockout — high stakes, daytime kickoff.',
   'Group winners get tested. If your Thursday is open, this is the move.',
   'Big crowd, knockout intensity.',
   ARRAY['hardcore fans']::TEXT[], 'high_effort',
   'Knockout premium.',
   'Upper bowl.',
   ARRAY['wc-round-of-32']::TEXT[], 0.85),

  ('fifa-wc-m98',
   'Final 8. This one matters.',
   'You''re four wins from the trophy. Whoever shows up at SoFi has earned a Friday matinee with the world watching.',
   'Sold out, electric, every play carries weight.',
   ARRAY['hardcore fans']::TEXT[], 'high_effort',
   'QF pricing — premium and worth it for stakes.',
   'Upper for entry, midfield lower for the memory.',
   ARRAY['wc-quarterfinal']::TEXT[], 0.92)
) AS i(source_event_id, verdict, why_worth_it, expectation_summary,
       target_audience, effort_level, price_insight, seat_expectation,
       context_flags, confidence_score)
JOIN games g ON g.source_event_id = i.source_event_id AND g.source = 'manual-wc-2026'
ON CONFLICT (game_id) DO NOTHING;

-- ============================================================
-- 5) TAGS — vibe markers picked up by the UI
-- ============================================================

INSERT INTO tags (game_id, tag_name, source_type, confidence)
SELECT g.id, t.tag_name, 'rule', 0.95
FROM games g
CROSS JOIN LATERAL (
  VALUES ('high-energy'), ('social-outing'), ('hardcore-fans')
) AS t(tag_name)
WHERE g.source = 'manual-wc-2026'
ON CONFLICT (game_id, tag_name) DO NOTHING;
