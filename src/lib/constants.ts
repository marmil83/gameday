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

// Deal Score weights
export const DEAL_SCORE_WEIGHTS = {
  price: 0.4,
  experience: 0.2,
  game_quality: 0.2,
  timing: 0.1,
  context: 0.1,
} as const;

// How many games to show per city per day
export const GAMES_PER_CITY = 5;

// Pricing transparency labels for UI
export const PRICING_LABELS: Record<string, string> = {
  all_in_verified: 'all-in',
  estimated_with_fees: 'estimated total',
  base_price_only: 'before fees',
};

// Average ticket prices by league (baseline for scoring)
// These are rough heuristics — can be refined with real data
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
