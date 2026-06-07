-- Price-drop alerts (email-only v1).
--
-- A visitor signs up on a game card → row is created with status='pending'
-- and a confirm_token sent to their email. They click the confirm link →
-- status='active'. The hourly-ish alerts cron compares each active alert's
-- baseline_price against the current cheapest snapshot for that game; if
-- the drop crosses the visitor's threshold AND we haven't notified within
-- the last 24h, fire an email and roll the baseline forward.
--
-- Double opt-in is non-negotiable for deliverability — Gmail/Yahoo (Feb
-- 2024 sender rules) will spam-fold a domain that mails unconfirmed
-- addresses at any volume.

CREATE TABLE price_alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id              UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  email                TEXT NOT NULL,
  -- 0 = any drop, 5 = require ≥5% drop, etc. NUMERIC so future granularity
  -- (e.g. "1.5%") doesn't require a schema change.
  threshold_pct        NUMERIC(4,1) NOT NULL DEFAULT 0,
  -- Cheapest price across all sources at the moment the alert was created.
  -- Null when the game had no price yet — the cron will fill this from
  -- the first snapshot it sees, then start watching for drops.
  baseline_price       NUMERIC(10,2),
  -- Cheapest price at the moment of the most recent notification (or
  -- baseline if never notified). The cron compares NEW price against
  -- THIS — so a 5%/5%/5% staircase fires three separate alerts instead
  -- of one big "down to $X" alert that never re-fires.
  last_notified_price  NUMERIC(10,2),
  last_notified_at     TIMESTAMPTZ,

  -- Unique per-row tokens for double-opt-in confirm + one-click unsub.
  -- Defaults to a fresh UUID so the row is immediately useful without
  -- an extra UPDATE. Both tokens are independent so an unsubscribe link
  -- exposed in an email can never be used to confirm a different alert.
  confirm_token        UUID NOT NULL DEFAULT gen_random_uuid(),
  unsubscribe_token    UUID NOT NULL DEFAULT gen_random_uuid(),

  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','active','unsubscribed','bounced')),
  -- Tracked for analytics ('card-button', 'admin', future 'tomorrows-games-email')
  source               TEXT NOT NULL DEFAULT 'card-button',

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at         TIMESTAMPTZ
);

-- One active alert per (email, game) — prevents accidental duplicates
-- when a visitor double-taps Submit. Pending rows can coexist (re-submit
-- after expired confirmation should work).
CREATE UNIQUE INDEX idx_alerts_one_active_per_email_game
  ON price_alerts (email, game_id)
  WHERE status = 'active';

-- The cron iterates active alerts by game; partial index keeps it fast.
CREATE INDEX idx_alerts_active_by_game
  ON price_alerts (game_id)
  WHERE status = 'active';

-- Token lookups (confirm / unsubscribe routes). Unique to short-circuit
-- collisions defensively.
CREATE UNIQUE INDEX idx_alerts_confirm_token     ON price_alerts (confirm_token);
CREATE UNIQUE INDEX idx_alerts_unsubscribe_token ON price_alerts (unsubscribe_token);

-- RLS: writes are server-only (API routes use service-role). No public
-- read needed — visitors never query their own alerts in this v1.
ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;
