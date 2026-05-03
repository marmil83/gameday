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
}): Promise<GameEnrichment> {
  const promoText = context.promotions.length > 0
    ? context.promotions.map(p => `- ${p.type}: ${p.description}`).join('\n')
    : 'No promotions detected.';

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `You are a sports recommendation engine. Generate enrichment data for a game listing.

Game Details:
- ${context.homeTeam} vs ${context.awayTeam}
- League: ${context.league}
- Venue: ${context.venue} (${context.isOutdoor ? 'outdoor' : 'indoor'})
- Start: ${context.startTime} (${context.dayOfWeek})
- Lowest ticket price: ${context.lowestPrice ? `$${context.lowestPrice} (${context.pricingTransparency})` : 'Unknown'}
- Typical ${context.league} ticket: $${context.avgLeaguePrice}

Promotions:
${promoText}

Generate the following as a JSON object:

1. "why_worth_it": One sentence explaining why this game is worth attending. Be specific and practical.

2. "verdict": One highly opinionated sentence about whether to go. This should feel confident and human — like advice from a friend. Examples: "Cheap, easy, and fun—nothing special, but worth it." or "Great matchup but overpriced tonight—skip unless you're a big fan."

3. "expectation_summary": Short description of what the atmosphere will feel like. Consider day of week, time, matchup.

4. "target_audience": Array of 1-3 from: "families", "date night", "casual fans", "hardcore fans", "cheap night out", "social outing"

5. "effort_level": One of: "easy", "moderate", "high_effort". Consider day/time, expected crowd.

6. "price_insight": Short insight about the pricing. Be honest. If no price data, say so.

7. "seat_expectation": What the displayed price likely gets you (e.g., "upper deck", "general admission").

8. "context_flags": Array of relevant situational flags (e.g., "outdoor game", "weekend", "potential weather concern"). Empty array if none.

9. "vibe_tags": Array of 1-3 from: "family-friendly", "high-energy", "cheap-night", "date-night", "chill", "promo-driven"

10. "promo_clarity": If promotions exist, provide practical guidance (e.g., "Free hat for first 10,000 fans — arrive early."). Null if no promos.

IMPORTANT RULES:
- Do NOT fabricate facts not supported by the provided data
- If price is unknown, say so — don't guess
- Be concise — each field should be 1-2 sentences max
- The verdict should be genuinely helpful and opinionated

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
