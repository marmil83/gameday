// GameDay Constants

export const VIBE_TAGS = [
  'family-friendly',
  'high-energy',
  'cheap-night',
  'date-night',
  'chill',
  'promo-driven',
] as const;

export const TARGET_AUDIENCES = [
  'families',
  'date night',
  'casual fans',
  'hardcore fans',
  'cheap night out',
  'social outing',
] as const;

export const PROMO_TYPES = [
  'giveaway',
  'theme_night',
  'fireworks',
  'special_ticket',
  'family_promo',
  'food_bev_promo',
] as const;

export const EFFORT_LEVELS = ['easy', 'moderate', 'high_effort'] as const;

// Deal Score weights — regular season default
export const DEAL_SCORE_WEIGHTS = {
  price: 0.4,
  experience: 0.2,
  game_quality: 0.2,
  timing: 0.1,
  context: 0.1,
} as const;

// Playoff weights — price matters less when stakes are huge.
// Atmosphere, quality, and context (round, weather) matter more.
// Used by every scoring path (deal-score.ts, rescore.ts, scripts/*) so playoff
// games never get judged by regular-season weights.
export const PLAYOFF_DEAL_SCORE_WEIGHTS = {
  price: 0.25,
  experience: 0.25,
  game_quality: 0.25,
  timing: 0.10,
  context: 0.15,
} as const;

// Pick the right weight set based on context flags
export function getDealScoreWeights(isPlayoffs?: boolean) {
  return isPlayoffs ? PLAYOFF_DEAL_SCORE_WEIGHTS : DEAL_SCORE_WEIGHTS;
}

// Experience baseline boosts — playoff atmosphere alone outranks most regular-season promos.
// Bumped from 3.0/4.0 → 4.0/5.5 so a no-promo playoff game scores 7.0 (was 6.0)
// and a no-promo elimination game scores 8.5 (was 7.0).
export const PLAYOFF_EXPERIENCE_BASELINE = 4.0;
export const ELIMINATION_EXPERIENCE_BASELINE = 5.5;

// How many games to show per city per day
export const GAMES_PER_CITY = 5;

// Pricing transparency labels for UI
export const PRICING_LABELS: Record<string, string> = {
  all_in_verified: 'all-in',
  estimated_with_fees: 'estimated total',
  base_price_only: 'before fees',
};

// Average ticket prices by league (baseline for regular season scoring)
export const LEAGUE_AVG_PRICES: Record<string, number> = {
  MLB: 35,
  NBA: 55,
  NHL: 60,
  NFL: 120,
  MLS: 35,
  NWSL: 25,
  WNBA: 40,
  'MiLB-AAA': 15,
  'MiLB-AA': 12,
  'MiLB-A+': 10,
  AHL: 20,
  USL: 18,
  WHL: 15,
};

// Playoff average prices by league + round.
// Playoff ticket markets are completely different from regular season —
// $59 for a Conference Semis game is exceptional even though it's "above" the $55 regular season avg.
export const PLAYOFF_AVG_PRICES: Record<string, Partial<Record<string, number>>> = {
  NBA: {
    'first-round':       150,
    'conference-semis':  200,
    'conference-finals': 350,
    'finals':            650,
  },
  NHL: {
    'first-round':       120,
    'conference-semis':  180,
    'conference-finals': 300,
    'finals':            550,
  },
  MLB: {
    'first-round':       100,  // Wild Card
    'conference-semis':  130,  // ALDS / NLDS
    'conference-finals': 220,  // ALCS / NLCS
    'finals':            550,  // World Series
  },
  NFL: {
    'first-round':       300,  // Wild Card
    'conference-semis':  500,  // Divisional
    'conference-finals': 750,  // Conference Championship
    'finals':          1_200,  // Super Bowl
  },
  AHL: {
    'first-round':        60,
    'conference-semis':   80,
    'conference-finals': 110,
    'finals':            150,
  },
};

/**
 * Returns the right price baseline for scoring — playoff-aware.
 * Falls back to regular season average if no playoff data exists.
 */
export function getPriceBaseline(
  league: string,
  playoffRound?: string | null,
): number {
  if (playoffRound) {
    const roundAvg = PLAYOFF_AVG_PRICES[league]?.[playoffRound];
    if (roundAvg) return roundAvg;
  }
  return LEAGUE_AVG_PRICES[league] ?? 40;
}
