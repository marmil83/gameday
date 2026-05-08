// Deal Score Calculator
// Rules-based, deterministic scoring engine
// AI classifies inputs; this module computes the score

import {
  LEAGUE_AVG_PRICES,
  getPriceBaseline,
  getDealScoreWeights,
  PLAYOFF_EXPERIENCE_BASELINE,
  ELIMINATION_EXPERIENCE_BASELINE,
} from '../constants';
import type { Game, PricingSnapshot, Promotion, GameInsight } from '@/types/database';

interface ScoreInputs {
  game: Game;
  pricing: PricingSnapshot | null;
  promotions: Promotion[];
  // These can be provided by AI or rules
  isRivalry?: boolean;
  hasStarPlayers?: boolean;
  teamQuality?: number;       // 0-10, baseline from standings (computed in enrich.ts)
  standingsRelevance?: number; // 0-10
  isPlayoffs?: boolean;
  isElimination?: boolean;    // elimination or finals game
  isOpeningDay?: boolean;
  playoffRound?: string | null; // e.g. 'first-round', 'conference-semis', 'conference-finals', 'finals'
  weatherScore?: number;       // 0-10, 10 = perfect weather
  isOutdoor?: boolean;
  timezone?: string;           // IANA timezone for local time calculations
  // Recent-form signal — both teams' last-10 records when known
  homeLast10?: { wins: number; losses: number } | null;
  awayLast10?: { wins: number; losses: number } | null;
  // Marquee matchup — both teams' overall win pct, used to detect when both
  // teams are top-quality. Computed by caller from standings.
  homeWinPct?: number | null;
  awayWinPct?: number | null;
}

interface ScoreResult {
  price_score: number;
  experience_score: number;
  game_quality_score: number;
  timing_score: number;
  context_score: number;
  deal_score: number;
  reasoning_summary: string;
  score_breakdown: Record<string, unknown>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals = 2): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

/**
 * Price Score (0-10)
 * How good is the ticket price relative to what you'd typically pay?
 * For playoff games, compares against the playoff market baseline (not regular season avg).
 */
function calculatePriceScore(
  game: Game,
  pricing: PricingSnapshot | null,
  playoffRound?: string | null,
): { score: number; reasoning: string } {
  if (!pricing || !pricing.lowest_price) {
    return { score: 5, reasoning: 'No pricing data available' };
  }

  // Use playoff-aware baseline — $59 vs $200 (Conference Semis avg) is a great deal,
  // but $59 vs $55 (regular season avg) is just average. Context matters.
  const avgPrice = getPriceBaseline(game.league, playoffRound);
  const price = pricing.displayed_price || pricing.lowest_price;

  // Score based on how far below average the price is
  // At average = 5, at 50% below = 8, at free = 10, at 2x average = 2
  const ratio = price / avgPrice;
  let score: number;

  if (ratio <= 0.25) score = 10;
  else if (ratio <= 0.5) score = 8 + (0.5 - ratio) * 8;
  else if (ratio <= 1.0) score = 5 + (1.0 - ratio) * 6;
  else if (ratio <= 1.5) score = 3 + (1.5 - ratio) * 4;
  else if (ratio <= 2.0) score = 1 + (2.0 - ratio) * 4;
  else score = 1;

  const marketLabel = playoffRound ? `playoff avg` : `typical`;
  const reasoning = ratio < 0.7
    ? `Great value at $${price} (${marketLabel}: $${avgPrice})`
    : ratio < 1.1
      ? `Fair price at $${price} (${marketLabel}: $${avgPrice})`
      : `Above average at $${price} (${marketLabel}: $${avgPrice})`;

  return { score: clamp(round(score), 0, 10), reasoning };
}

/**
 * Experience Score (0-10)
 * Promotions, giveaways, theme nights, special events
 */
function calculateExperienceScore(
  promotions: Promotion[],
  isPlayoffs?: boolean,
  isElimination?: boolean,
): { score: number; reasoning: string } {
  // Playoff baseline: atmosphere alone is genuinely different — rally towels,
  // shirts, and deafening crowds are virtually guaranteed at home playoff games.
  // Sourced from constants so every scoring path stays in sync.
  const playoffBaseline = isElimination ? ELIMINATION_EXPERIENCE_BASELINE : isPlayoffs ? PLAYOFF_EXPERIENCE_BASELINE : 0;

  if (promotions.length === 0) {
    const baseScore = 3 + playoffBaseline;
    const reasoning = isElimination
      ? 'Playoff atmosphere — expect giveaways and electric crowd'
      : isPlayoffs
        ? 'Playoff atmosphere — elevated energy and likely giveaways'
        : 'No promotions detected';
    return { score: clamp(baseScore, 0, 10), reasoning };
  }

  let score = 3 + playoffBaseline; // baseline
  const highlights: string[] = [];

  for (const promo of promotions) {
    switch (promo.promo_type) {
      case 'giveaway':
        score += 3;
        highlights.push(promo.promo_item || 'giveaway');
        break;
      case 'fireworks':
        score += 2.5;
        highlights.push('fireworks');
        break;
      case 'theme_night':
        score += 2;
        highlights.push('theme night');
        break;
      case 'family_promo':
        score += 1.5;
        highlights.push('family promo');
        break;
      case 'food_bev_promo':
        score += 1.5;
        highlights.push('food/drink deal');
        break;
      case 'special_ticket':
        score += 1;
        highlights.push('special ticket package');
        break;
      default:
        score += 1;
    }
  }

  const reasoning = highlights.length > 0
    ? `Includes: ${highlights.join(', ')}`
    : 'Standard game experience';

  return { score: clamp(round(score), 0, 10), reasoning };
}

/**
 * Game Quality Score (0-10)
 * Rivalry, star players, team quality, standings relevance
 */
function calculateGameQualityScore(inputs: ScoreInputs): { score: number; reasoning: string } {
  let score = 5; // baseline for an average game
  const factors: string[] = [];

  if (inputs.isRivalry) {
    score += 2;
    factors.push('rivalry matchup');
  }
  if (inputs.hasStarPlayers) {
    score += 1.5;
    factors.push('star players');
  }
  if (inputs.teamQuality !== undefined) {
    // Adjust based on how good the teams are (0-10 scale input)
    score += (inputs.teamQuality - 5) * 0.3;
  }
  if (inputs.standingsRelevance !== undefined) {
    score += (inputs.standingsRelevance - 5) * 0.3;
  }

  // Recent form — only trusted at 8+ L10 games (early-season noise guard)
  const homeL10Total = (inputs.homeLast10?.wins ?? 0) + (inputs.homeLast10?.losses ?? 0);
  const homeL10Pct = homeL10Total > 0 ? (inputs.homeLast10!.wins / homeL10Total) : null;
  if (homeL10Total >= 8 && homeL10Pct != null && homeL10Pct >= 0.7) { score += 1; factors.push(`home L10 ${inputs.homeLast10!.wins}-${inputs.homeLast10!.losses}`); }
  else if (homeL10Total >= 8 && homeL10Pct != null && homeL10Pct <= 0.3) { score -= 0.5; factors.push(`home cold L10`); }
  const awayL10Total = (inputs.awayLast10?.wins ?? 0) + (inputs.awayLast10?.losses ?? 0);
  const awayL10Pct = awayL10Total > 0 ? (inputs.awayLast10!.wins / awayL10Total) : null;
  if (awayL10Total >= 8 && awayL10Pct != null && awayL10Pct >= 0.7) { score += 0.5; factors.push('visitor hot'); }

  // Marquee matchup — both teams ≥ .600 is an A-list bill
  if ((inputs.homeWinPct ?? 0) >= 0.6 && (inputs.awayWinPct ?? 0) >= 0.6) {
    score += 1;
    factors.push('marquee matchup');
  }

  const reasoning = factors.length > 0
    ? `Notable: ${factors.join(', ')}`
    : 'Standard matchup';

  return { score: clamp(round(score), 0, 10), reasoning };
}

/**
 * Timing Score (0-10)
 * Day of week, time of day, ease of attending
 */
function calculateTimingScore(game: Game, timezone?: string, isPlayoffs?: boolean): { score: number; reasoning: string } {
  const startTime = new Date(game.start_time);

  // Use timezone-aware local time if available, otherwise fall back to UTC
  let dayOfWeek: number;
  let hour: number;
  if (timezone) {
    const localParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(startTime);
    const weekdayStr = localParts.find(p => p.type === 'weekday')?.value || '';
    const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    dayOfWeek = dayMap[weekdayStr] ?? startTime.getDay();
    hour = parseInt(localParts.find(p => p.type === 'hour')?.value || '0');
    if (hour === 24) hour = 0; // midnight edge case
  } else {
    dayOfWeek = startTime.getDay();
    hour = startTime.getHours();
  }

  // Detect TBD/placeholder times (local hour 0-4 = likely unannounced)
  if (hour >= 0 && hour < 5) {
    return { score: 5, reasoning: 'Game time TBD' };
  }

  let score = 5;
  const factors: string[] = [];

  // Weekend bonus
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    score += 2;
    factors.push('weekend');
  } else if (dayOfWeek === 5) {
    score += 1.5;
    factors.push('Friday');
  }

  // Time of day
  if (hour >= 17 && hour <= 19) {
    score += 1.5; // after-work sweet spot
    factors.push('evening start');
  } else if (hour >= 12 && hour <= 15) {
    score += 1; // daytime/matinee
    factors.push('daytime game');
  } else if (hour >= 20) {
    score -= 0.5; // late start
    factors.push('late start');
  }

  // Playoff games: people rearrange their schedule regardless of day.
  // Boost weeknight penalty relief (+1) and cap late-start penalty.
  if (isPlayoffs && dayOfWeek >= 1 && dayOfWeek <= 4) {
    score += 1;
    factors.push('playoff weeknight');
  }

  const reasoning = factors.length > 0
    ? factors.join(', ')
    : 'Weeknight game';

  return { score: clamp(round(score), 0, 10), reasoning };
}

/**
 * Context Score (0-10)
 * Weather, playoffs, special circumstances
 */
function calculateContextScore(inputs: ScoreInputs): { score: number; reasoning: string } {
  let score = 5;
  const factors: string[] = [];

  if (inputs.isPlayoffs) {
    score += 3;
    factors.push('playoff game');
  }
  if (inputs.isOpeningDay) {
    score += 2;
    factors.push('opening day');
  }

  // Weather (only matters for outdoor venues)
  if (inputs.isOutdoor && inputs.weatherScore !== undefined) {
    const weatherAdjustment = (inputs.weatherScore - 5) * 0.4;
    score += weatherAdjustment;
    if (inputs.weatherScore >= 7) factors.push('great weather');
    if (inputs.weatherScore <= 3) factors.push('weather concern');
  }

  const reasoning = factors.length > 0
    ? factors.join(', ')
    : 'Standard conditions';

  return { score: clamp(round(score), 0, 10), reasoning };
}

/**
 * Calculate the composite Deal Score
 */
export function calculateDealScore(inputs: ScoreInputs): ScoreResult {
  const price = calculatePriceScore(inputs.game, inputs.pricing, inputs.playoffRound);
  const experience = calculateExperienceScore(inputs.promotions, inputs.isPlayoffs, inputs.isElimination);
  const gameQuality = calculateGameQualityScore(inputs);
  const timing = calculateTimingScore(inputs.game, inputs.timezone, inputs.isPlayoffs);
  const context = calculateContextScore(inputs);

  // Pick weight profile — playoffs de-emphasize price, boost experience/quality/context
  const weights = getDealScoreWeights(inputs.isPlayoffs);

  const deal_score = round(
    price.score * weights.price +
    experience.score * weights.experience +
    gameQuality.score * weights.game_quality +
    timing.score * weights.timing +
    context.score * weights.context
  );

  // Build reasoning summary
  const topFactors: string[] = [];
  if (price.score >= 7) topFactors.push('great price');
  if (experience.score >= 7) topFactors.push('great promotions');
  if (gameQuality.score >= 7) topFactors.push('compelling matchup');
  if (timing.score >= 7) topFactors.push('convenient timing');
  if (context.score >= 7) topFactors.push('special context');

  const reasoning_summary = topFactors.length > 0
    ? `Strong because: ${topFactors.join(', ')}`
    : `Solid option with a balanced score across factors`;

  return {
    price_score: price.score,
    experience_score: experience.score,
    game_quality_score: gameQuality.score,
    timing_score: timing.score,
    context_score: context.score,
    deal_score: clamp(deal_score, 0, 10),
    reasoning_summary,
    score_breakdown: {
      price: { score: price.score, weight: weights.price, reasoning: price.reasoning },
      experience: { score: experience.score, weight: weights.experience, reasoning: experience.reasoning },
      game_quality: { score: gameQuality.score, weight: weights.game_quality, reasoning: gameQuality.reasoning },
      timing: { score: timing.score, weight: weights.timing, reasoning: timing.reasoning },
      context: { score: context.score, weight: weights.context, reasoning: context.reasoning },
    },
  };
}
