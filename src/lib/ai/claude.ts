// Claude AI integration for GameDay enrichment
// Used for: promotion extraction, vibe tags, insights, verdicts

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface PromotionExtraction {
  promo_type: string;
  promo_item: string | null;
  description: string;
  date: string | null;
  opponent: string | null;
  special_ticket_required: boolean;
  eligibility_details: string | null;
  confidence_score: number;
}

interface GameEnrichment {
  why_worth_it: string;
  verdict: string;
  expectation_summary: string;
  target_audience: string[];
  effort_level: string;
  price_insight: string;
  seat_expectation: string;
  context_flags: string[];
  vibe_tags: string[];
  promo_clarity: string | null;
}

/**
 * Extract structured promotions from raw scraped text
 */
export async function extractPromotions(
  rawText: string,
  teamName: string,
  gameDate: string
): Promise<PromotionExtraction[]> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `You are a sports promotion data extractor. Given raw text from a team's official promotions page, extract structured promotion data.

Team: ${teamName}
Target Date: ${gameDate}

Raw text from promotions page:
---
${rawText}
---

Extract ALL promotions relevant to the target date. Return a JSON array of promotions.

Each promotion should have:
- promo_type: one of "giveaway", "theme_night", "fireworks", "special_ticket", "family_promo", "food_bev_promo"
- promo_item: specific item if applicable (e.g., "bobblehead", "rally towel"), or null
- description: clean, concise description
- date: the date this promotion applies to (YYYY-MM-DD format), or null if unclear
- opponent: the opposing team if mentioned, or null
- special_ticket_required: boolean — true if a special ticket package is needed
- eligibility_details: e.g., "first 10,000 fans", or null
- confidence_score: 0.0 to 1.0 — how confident you are this extraction is accurate

IMPORTANT:
- Only extract promotions that are clearly stated in the text
- Do NOT invent or fabricate promotions
- If the date doesn't match the target date, still include it but note the actual date
- Set confidence_score lower if the text is ambiguous

Return ONLY valid JSON array. No other text.`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    return JSON.parse(jsonMatch[0]) as PromotionExtraction[];
  } catch {
    console.error('Failed to parse promotion extraction response:', text);
    return [];
  }
}

/**
 * Generate full game enrichment (insights, tags, verdict)
 */
export async function enrichGame(context: {
  homeTeam: string;
  awayTeam: string;
  league: string;
  venue: string;
  startTime: string;
  dayOfWeek: string;
  lowestPrice: number | null;
  avgLeaguePrice: number;
  pricingTransparency: string;
  promotions: { type: string; item: string | null; description: string }[];
  isOutdoor: boolean;
  // Live standings — grounded data, do not substitute training knowledge
  homeRecord?: string | null;   // e.g. "18-18"
  awayRecord?: string | null;
  homeStreak?: string | null;   // e.g. "W3" or "L1"
  // Big game context — injected by detectBigGame
  bigGameLabel?: string | null;
  isElimination?: boolean;
  isFinals?: boolean;
  isRivalry?: boolean;
  rivalryName?: string | null;
  seriesRecord?: string | null;
  isOpeningDay?: boolean;
  isPlayoffs?: boolean;
}): Promise<GameEnrichment> {
  const hasPromos = context.promotions.length > 0;
  const promoText = hasPromos
    ? context.promotions.map(p => `- ${p.type}: ${p.description}`).join('\n')
    : context.isPlayoffs
      ? 'No promos confirmed yet — but playoff home games almost always include rally towels, shirts, or similar giveaways. Mention likely elevated atmosphere.'
      : 'No promotions detected.';

  // Build big game section only when relevant
  const bigGameLines: string[] = [];
  if (context.bigGameLabel) bigGameLines.push(`- THIS IS: ${context.bigGameLabel}`);
  if (context.isElimination) bigGameLines.push('- ELIMINATION GAME: Lose and you go home. Max stakes.');
  if (context.isFinals) bigGameLines.push('- CHAMPIONSHIP SERIES: The biggest stage in the sport.');
  if (context.isRivalry && context.rivalryName) bigGameLines.push(`- RIVALRY GAME: ${context.rivalryName} — historic matchup, crowd will be electric.`);
  if (context.seriesRecord) bigGameLines.push(`- Series status: ${context.seriesRecord}`);
  if (context.isOpeningDay) bigGameLines.push('- OPENING DAY: First game of the season — always special.');

  const bigGameSection = bigGameLines.length > 0
    ? `\nGame Context (HIGH PRIORITY — reflect this in your copy):\n${bigGameLines.join('\n')}`
    : '';

  const verdictGuidance = context.isElimination || context.isFinals
    ? 'For this game: be emphatic. This is a historic, must-see event. Do not hedge.'
    : context.isPlayoffs
      ? 'For this game: lead with the playoff stakes. Be energetic.'
      : 'The verdict should be genuinely helpful and opinionated.';

  // Hard ban on hedging language for actual playoff games
  const playoffLanguageRule = context.isPlayoffs
    ? `\n\nCRITICAL LANGUAGE RULE: This IS the playoffs. Never write "playoff-caliber", "playoff-level", "playoff-like", "playoff-style", "playoff implications", "feels like a playoff game", or any similar hedge. Say "the playoffs", "a playoff game", "playoff [round name]", or name the specific stakes directly. Hedging on a real playoff game is the worst possible mistake — readers will know and lose trust.`
    : '';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `You are the voice behind GameDay — a witty, sharp sports recommendation product with the energy of Morning Brew meets the honesty of a friend who's been to way too many games. You give real opinions, not press releases.

Your writing style:
- Conversational and confident — like texting a friend who actually knows sports
- Specific, never generic — use the actual teams, price, promo, situation
- Light wit and wordplay welcome — puns are fine if they land, skip them if they don't
- Short punchy sentences mixed with longer ones for rhythm
- Honest about value — if it's a weak matchup at a bad price, say so tactfully
- For big games (playoffs, rivalry, elimination): drop the hedging, bring the energy
- Em dashes, parentheticals, and direct address ("you'll want to...") encouraged
- Never corporate, never boring, never just reciting facts back

Game Details:
- ${context.homeTeam} vs ${context.awayTeam}
- League: ${context.league}
- Venue: ${context.venue} (${context.isOutdoor ? 'outdoor' : 'indoor'})
- Start: ${context.startTime} (${context.dayOfWeek})
- Lowest ticket price: ${context.lowestPrice ? `$${context.lowestPrice} (${context.pricingTransparency})` : 'Unknown'}
- Typical ${context.league} ticket: $${context.avgLeaguePrice}
- ${context.homeTeam} record: ${context.homeRecord ?? 'unknown'}${context.homeStreak && !context.isPlayoffs ? ` (${context.homeStreak})` : ''}
- ${context.awayTeam} record: ${context.awayRecord ?? 'unknown'}
${context.isPlayoffs ? '- NOTE: Streak data reflects end of regular season — do NOT mention win/loss streaks for playoff games.' : ''}
${bigGameSection}${playoffLanguageRule}

Promotions:
${promoText}

Generate the following as a JSON object:

1. "why_worth_it": One punchy sentence on why this game is worth showing up for. Lead with the most compelling thing — big game context, a steal of a price, an unmissable promo. Make it specific, not generic.

2. "verdict": One confident, opinionated sentence — your actual take on whether to go. ${verdictGuidance} Don't sit on the fence.

3. "expectation_summary": One sentence painting a picture of what it'll actually feel like to be there. Honest about energy level — don't hype a rebuilding team's Tuesday night game the same as a playoff clincher.

4. "target_audience": Array of 1-3 from: "families", "date night", "casual fans", "hardcore fans", "cheap night out", "social outing"

5. "effort_level": One of: "easy", "moderate", "high_effort"

6. "price_insight": One sentence with a genuine take on the price — is it a steal, fair, or a stretch? For big games, note that prices tend to climb closer to tip-off/first pitch.

7. "seat_expectation": What the entry price likely gets you in plain English (e.g., "upper deck with a full view of the action", "lower bowl if you're lucky").

8. "context_flags": Array of relevant flags from: "playoff", "elimination", "rivalry", "game-7", "finals", "conference-finals", "opening-day". CRITICAL: If this is a playoff game, you MUST also include the round slug — one of: "first-round", "conference-semis", "conference-finals", "finals". Infer the round from ticket prices relative to typical league averages (NHL first-round ~$120, conference-semis ~$180, conference-finals ~$300; NBA first-round ~$150, conference-semis ~$200). Always include a round slug when "playoff" is in the flags.

9. "vibe_tags": Array of 1-3 from: "family-friendly", "high-energy", "cheap-night", "date-night", "chill", "promo-driven"

10. "promo_clarity": If promotions exist, one practical sentence on what to expect (arrive early? special ticket needed?). Null if no promos.

IMPORTANT RULES:
- Team records and streaks are provided above — use ONLY those values. Do NOT draw on any external or training knowledge about team performance.
- If price is unknown, say so — don't guess
- Each field is 1-2 sentences max — tight writing, no padding
- ${verdictGuidance}

Return ONLY valid JSON. No other text.`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    return JSON.parse(jsonMatch[0]) as GameEnrichment;
  } catch {
    console.error('Failed to parse enrichment response:', text);
    // Return safe defaults — never fabricate
    return {
      why_worth_it: 'A solid option for catching a live game.',
      verdict: 'Worth considering if you\'re looking for something to do.',
      expectation_summary: 'Standard game atmosphere expected.',
      target_audience: ['casual fans'],
      effort_level: 'moderate',
      price_insight: 'Pricing data unavailable.',
      seat_expectation: 'Exact seat location depends on availability.',
      context_flags: [],
      vibe_tags: ['chill'],
      promo_clarity: null,
    };
  }
}
