// Scrape promotions from team promo pages using Puppeteer + Claude AI extraction
// Usage: npx tsx scripts/scrape-promos.ts [--city detroit|portland]

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import puppeteer from 'puppeteer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Scrape rendered text from a promo page using Puppeteer
 */
async function scrapePromoPage(url: string): Promise<string | null> {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait a bit for lazy-loaded content
    await new Promise(r => setTimeout(r, 2000));
    const text = await page.evaluate(() => document.body.innerText);
    return text.slice(0, 20000); // Limit for AI processing
  } catch (error) {
    console.error(`  Failed to scrape ${url}:`, error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Use Claude to extract structured promotions from scraped text
 */
async function extractPromotions(rawText: string, teamName: string): Promise<any[]> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    messages: [{
      role: 'user',
      content: `You are a sports promotion data extractor. Given raw text from a team's official promotions page, extract ALL promotions and giveaways.

Team: ${teamName}

Raw text from promotions page:
---
${rawText}
---

Extract EVERY promotion listed. For each one return:
- date: the game date (YYYY-MM-DD format). Parse from the text (e.g. "Friday May 1" = "2026-05-01")
- opponent: the opposing team name, or null
- promo_type: one of "giveaway", "theme_night", "fireworks", "special_ticket", "family_promo", "food_bev_promo"
- promo_item: specific item if it's a giveaway (e.g., "bobblehead", "rally towel", "jersey"), or null
- promo_description: clean, concise description of the promotion
- special_ticket_required: boolean — true if a special ticket package is needed
- eligibility_details: e.g., "first 10,000 fans", "kids 14 and under", or null
IMPORTANT:
- The current year is 2026
- Only extract promotions clearly stated in the text — do NOT invent any
- A single game date can have multiple promotions — list each separately
- "313 Value Game" / dollar deals = "food_bev_promo"
- "Friday Night Fireworks" = "fireworks"
- "Gate Giveaway" = "giveaway"
- "Special Ticket Package" = "special_ticket"
- "Kids Day" / family events = "family_promo"
- Heritage nights / themed events = "theme_night"

Return ONLY a valid JSON array.`
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error('  No JSON array found in AI response. Stop reason:', response.stop_reason);
      console.error('  Response preview:', text.slice(0, 200));
      return [];
    }
    return JSON.parse(match[0]);
  } catch (e) {
    console.error('  Failed to parse AI response:', e);
    return [];
  }
}

/**
 * Match extracted promotions to games in the database and save
 */
async function savePromotions(teamId: string, promos: any[], sourceUrl: string) {
  let saved = 0;

  for (const promo of promos) {
    if (!promo.date) continue;

    // Find the game for this date and team
    const dayStart = `${promo.date}T00:00:00.000Z`;
    const dayEnd = `${promo.date}T23:59:59.999Z`;

    const { data: games } = await supabase
      .from('games')
      .select('id')
      .eq('home_team_id', teamId)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .limit(1);

    if (!games || games.length === 0) continue;

    const gameId = games[0].id;

    // Check for duplicate
    const { data: existing } = await supabase
      .from('promotions')
      .select('id')
      .eq('game_id', gameId)
      .eq('promo_description', promo.promo_description)
      .limit(1);

    if (existing && existing.length > 0) continue;

    const { error } = await supabase.from('promotions').insert({
      game_id: gameId,
      source_url: sourceUrl,
      raw_text: null,
      promo_type: promo.promo_type,
      promo_item: promo.promo_item || null,
      promo_description: promo.promo_description,
      special_ticket_required: promo.special_ticket_required || false,
      eligibility_details: promo.eligibility_details || null,
      confidence_score: promo.confidence_score || 0.8,
      is_ai_extracted: true,
      is_admin_verified: false,
    });

    if (error) {
      console.error(`  DB error: ${error.message}`);
    } else {
      saved++;
    }
  }

  return saved;
}

async function main() {
  const cityArg = process.argv.find(a => a.startsWith('--city='))?.split('=')[1]
    || (process.argv.includes('--city') ? process.argv[process.argv.indexOf('--city') + 1] : null);

  // Get teams with promo URLs
  let query = supabase
    .from('teams')
    .select('id, name, short_name, city_id, promo_page_url')
    .not('promo_page_url', 'is', null);

  if (cityArg) {
    const { data: city } = await supabase
      .from('cities')
      .select('id')
      .ilike('name', `%${cityArg}%`)
      .single();
    if (city) {
      query = query.eq('city_id', city.id);
    }
  }

  const { data: teams, error } = await query;
  if (error || !teams) {
    console.error('Failed to fetch teams:', error?.message);
    return;
  }

  console.log(`Scraping promotions for ${teams.length} teams\n`);

  let totalSaved = 0;

  for (const team of teams) {
    console.log(`[${team.short_name}] ${team.name}`);
    console.log(`  URL: ${team.promo_page_url}`);

    const rawText = await scrapePromoPage(team.promo_page_url);
    if (!rawText || rawText.length < 100) {
      console.log('  No content scraped, skipping');
      continue;
    }
    console.log(`  Scraped ${rawText.length} chars`);

    const promos = await extractPromotions(rawText, team.name);
    console.log(`  Extracted ${promos.length} promotions`);

    if (promos.length > 0) {
      const saved = await savePromotions(team.id, promos, team.promo_page_url);
      console.log(`  Saved ${saved} to database`);
      totalSaved += saved;
    }

    console.log('');
  }

  console.log(`Done! Saved ${totalSaved} promotions total.`);
}

main();
