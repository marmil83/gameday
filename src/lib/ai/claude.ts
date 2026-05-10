// Claude AI integration for Foamfinger enrichment
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
// Retry once after a 65s wait when Claude rate-limits us. The promo
// scraper used to swallow these silently — every team after a 429 would
// return 0 promos, which is how the Dodgers schedule was missing for so
// long without anyone noticing.
type MessageBody = Parameters<typeof anthropic.messages.create>[0];
type MessageResp = Anthropic.Messages.Message;
async function callClaudeWithRetry(body: MessageBody): Promise<MessageResp> {
  try {
    return (await anthropic.messages.create(body)) as MessageResp;
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 429) {
      console.warn('[claude] 429 rate limit — waiting 65s and retrying once');
      await new Promise(r => setTimeout(r, 65_000));
      return (await anthropic.messages.create(body)) as MessageResp;
    }
    throw err;
  }
}

export async function extractPromotions(
  rawText: string,
  teamName: string,
  gameDate: string
): Promise<PromotionExtraction[]> {
  const response = await callClaudeWithRetry({
    model: 'claude-sonnet-4-20250514',
    // Promo schedule pages can list 50+ items for a full season. 2000
    // tokens silently truncated the JSON mid-array (no closing ]),
    // making the parse fall through to []. 6000 covers a full MLB
    // season comfortably.
    max_tokens: 6000,
    messages: [
      {
        role: 'user',
        content: `You are a sports promotion data extractor. Given raw text from a team's official promotions page, extract dated promotions for an upcoming game.

Team: ${teamName}
Reference date: ${gameDate}

Raw text from promotions page:
---
${rawText}
---

Extract every promotion on this page whose date is within ±14 days of the Reference date (i.e. within two weeks before or after). Skip every promotion outside that window — they're either historical or far in the future and waste output tokens. Return a JSON array.

Each promotion must have:
- promo_type: one of "giveaway", "theme_night", "fireworks", "special_ticket", "family_promo", "food_bev_promo"
- promo_item: the specific item exactly as named on the page (e.g., "T-shirt", "bobblehead", "rally towel", "acrylic mini court"). Null only if no item is mentioned (e.g., a theme night with no giveaway).
- description: a clean one-sentence description that pulls ONLY from the text adjacent to this specific date. Do NOT mix in details from other dates.
- date: YYYY-MM-DD. Required. Promo pages often write dates without a year (e.g. "Sunday, May 10" or "May 10 vs. Braves"). When a year is missing, infer it from the Reference date provided above (use the same year). The combination of month + day + day-of-week is unambiguous within a season. Set to null ONLY if the page truly has no date at all for this promo (rare).
- opponent: the opposing team if mentioned next to this entry, else null
- special_ticket_required: boolean — true only if explicitly stated
- eligibility_details: e.g., "first 10,000 fans" or "all fans in attendance", or null
- confidence_score: 0.0–1.0

CRITICAL — anti-hallucination rules:
- Each promotion's item, description, sponsor, and date MUST come from the same contiguous block of text. Never combine an item from one date with a description from another date.
- If two dates each mention a different giveaway, return TWO separate entries — never merge them.
- If a date appears with no clear giveaway/theme attached, do not invent one. Skip it.
- Sponsor names ("courtesy of X") belong only with the entry where that sponsor is explicitly named.
- Better to omit an unclear promotion than to fabricate one. Drop it and lower confidence on uncertain entries.

Return ONLY valid JSON array. No other text.`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  // First try strict parse — when the response contains a clean array.
  try {
    const m = text.match(/\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]) as PromotionExtraction[];
  } catch {
    // fall through to lenient recovery
  }

  // Lenient recovery: extract every complete `{...}` object we can find.
  // Handles cases where the JSON gets truncated mid-array because Claude
  // hit the max_tokens ceiling — we lose the last partial item but still
  // get every item before it. Critical because pages with 50+ promos can
  // exceed even 6000 tokens and silently dropping ALL of them was the
  // bug that made the entire Dodgers schedule disappear.
  const recovered: PromotionExtraction[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          recovered.push(JSON.parse(text.slice(start, i + 1)) as PromotionExtraction);
        } catch { /* skip malformed object */ }
        start = -1;
      }
    }
  }
  if (recovered.length === 0) {
    console.error('Failed to parse promotion extraction response (no complete objects found):', text.slice(0, 500));
  }
  return recovered;
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
  // Recent form (last 10 games) — useful for verdict copy when standings sample is small
  homeLast10?: string | null;   // e.g. "7-3"
  awayLast10?: string | null;
  // Venue logistics — only used when notable (expensive parking + transit
  // alternative). Keeps Claude from mentioning it on every game.
  parkingPrice?: number | null;
  transitNotes?: string | null;
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

  const response = await callClaudeWithRetry({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: `You are the voice behind Foamfinger — a witty, sharp sports recommendation product with the energy of Morning Brew meets the honesty of a friend who's been to way too many games. You give real opinions, not press releases.

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
- ${context.homeTeam} record: ${context.homeRecord ?? 'unknown'}${context.homeStreak && !context.isPlayoffs ? ` (${context.homeStreak})` : ''}${context.homeLast10 && !context.isPlayoffs ? `, last 10: ${context.homeLast10}` : ''}
- ${context.awayTeam} record: ${context.awayRecord ?? 'unknown'}${context.awayLast10 && !context.isPlayoffs ? `, last 10: ${context.awayLast10}` : ''}
${context.isPlayoffs ? '- NOTE: Streak data reflects end of regular season — do NOT mention win/loss streaks for playoff games.' : ''}
${context.parkingPrice != null ? `- Parking ~$${context.parkingPrice}${context.transitNotes ? ` (transit alternative: ${context.transitNotes})` : ''}` : ''}
${bigGameSection}${playoffLanguageRule}

Promotions:
${promoText}

Generate the following as a JSON object:

1. "why_worth_it": One punchy sentence on why this game is worth showing up for. Lead with the most compelling thing — big game context, a steal of a price, an unmissable promo. Make it specific, not generic.

2. "verdict": One confident, opinionated sentence — your actual take on whether to go. ${verdictGuidance} Don't sit on the fence.

3. "expectation_summary": One sentence painting a picture of what it'll actually feel like to be there. Honest about energy level — don't hype a rebuilding team's Tuesday night game the same as a playoff clincher.

4. "target_audience": Array of 1-3 from: "families", "date night", "casual fans", "hardcore fans", "cheap night out", "social outing"

5. "effort_level": One of: "easy", "moderate", "high_effort"

6. "price_insight": One sentence with a genuine take on the price level — is it a steal, fair, or a stretch? For big games, note that prices tend to climb closer to tip-off/first pitch. CRITICAL: Do NOT include the specific dollar amount (e.g. "$232", "at $150") — the UI displays the live price prominently and it refreshes on its own cadence; baking a number into the copy will go stale within hours and contradict what the user sees. Use relative language: "premium pricing", "well below typical", "fair value for a playoff game", "a steal given the matchup", etc.

7. "seat_expectation": What the entry price likely gets you in plain English (e.g., "upper deck with a full view of the action", "lower bowl if you're lucky").

8. "context_flags": Array of relevant flags from: "playoff", "elimination", "rivalry", "game-7", "finals", "conference-finals", "opening-day". CRITICAL: If this is a playoff game, you MUST also include the round slug — one of: "first-round", "conference-semis", "conference-finals", "finals". Infer the round from ticket prices relative to typical league averages (NHL first-round ~$120, conference-semis ~$180, conference-finals ~$300; NBA first-round ~$150, conference-semis ~$200). Always include a round slug when "playoff" is in the flags. ONLY use "opening-day" for the literal first regular-season game (league-wide opener or a franchise's debut/inaugural home game) — NEVER for "early-season" or "first home stand" games. The system independently verifies opening day from the date and will reject false claims.

9. "vibe_tags": Array of 1-3 from: "family-friendly", "high-energy", "cheap-night", "date-night", "chill", "promo-driven"

10. "promo_clarity": If promotions exist, one practical sentence on what to expect (arrive early? special ticket needed?). Null if no promos.

IMPORTANT RULES:
- Team records and streaks are provided above — use ONLY those values. Do NOT draw on any external or training knowledge about team performance.
- If price is unknown, say so — don't guess
- Each field is 1-2 sentences max — tight writing, no padding
- NO DOLLAR AMOUNTS in verdict, why_worth_it, expectation_summary, seat_expectation, promo_clarity, or price_insight. Live prices change throughout the day and are displayed by the UI directly; embedding "$172" or "at $204" into copy guarantees it'll go stale and contradict what users see. Always use relative language ("premium", "great value", "above typical", "below average") instead.
- Parking & transit info is shown by the UI in its own row — only mention it in copy when it's an unusually notable factor (e.g. SoFi's brutal parking, a venue where transit lets you skip a $40 lot). Never on every game; never restate the dollar amount.
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
