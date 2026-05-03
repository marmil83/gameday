// Promotion Scraping Pipeline
// Scrapes official team promo pages and uses AI to extract structured data

import * as cheerio from 'cheerio';
import { createServiceClient } from '../supabase/server';
import { extractPromotions } from '../ai/claude';
import type { Team } from '@/types/database';

/**
 * Scrape text content from a URL
 */
async function scrapePageText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GameDay/1.0)',
      },
    });

    if (!response.ok) {
      console.error(`Failed to scrape ${url}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove scripts, styles, nav, footer
    $('script, style, nav, footer, header, iframe').remove();

    // Get main content text
    const text = $('main, article, .content, .promotions, .promos, [class*="promo"], body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // Limit to reasonable length for AI processing
    return text.slice(0, 8000);
  } catch (error) {
    console.error(`Scrape error for ${url}:`, error);
    return null;
  }
}

/**
 * Scrape and extract promotions for all games of a team on a given date
 */
export async function scrapePromotionsForTeam(
  team: Team,
  targetDate: string // YYYY-MM-DD
): Promise<{
  extracted: number;
  errors: string[];
}> {
  const supabase = createServiceClient();
  const errors: string[] = [];

  if (!team.promo_page_url) {
    return { extracted: 0, errors: ['No promo page URL configured'] };
  }

  // Scrape the promo page
  const rawText = await scrapePageText(team.promo_page_url);
  if (!rawText) {
    return { extracted: 0, errors: [`Failed to scrape ${team.promo_page_url}`] };
  }

  // Use AI to extract promotions
  const promotions = await extractPromotions(rawText, team.name, targetDate);

  // Find games for this team on this date
  const dayStart = new Date(targetDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(23, 59, 59, 999);

  const { data: games } = await supabase
    .from('games')
    .select('id, start_time')
    .eq('home_team_id', team.id)
    .gte('start_time', dayStart.toISOString())
    .lte('start_time', dayEnd.toISOString());

  if (!games || games.length === 0) {
    return { extracted: promotions.length, errors: ['No games found for this date'] };
  }

  let extracted = 0;

  for (const promo of promotions) {
    // Match promo to the right game (by date if multiple games)
    const matchedGame = games[0]; // For MVP, assume one game per team per day

    const { error } = await supabase.from('promotions').insert({
      game_id: matchedGame.id,
      source_url: team.promo_page_url,
      raw_text: rawText.slice(0, 2000), // Store truncated raw text
      promo_type: promo.promo_type,
      promo_item: promo.promo_item,
      promo_description: promo.description,
      special_ticket_required: promo.special_ticket_required,
      eligibility_details: promo.eligibility_details,
      confidence_score: promo.confidence_score,
      is_ai_extracted: true,
      is_admin_verified: false,
    });

    if (error) {
      errors.push(`Failed to insert promo: ${error.message}`);
    } else {
      extracted++;
    }
  }

  return { extracted, errors };
}

/**
 * Scrape promotions for all teams in a city
 */
export async function scrapePromotionsForCity(
  cityId: string,
  targetDate: string
): Promise<{
  total_extracted: number;
  errors: string[];
}> {
  const supabase = createServiceClient();

  const { data: teams } = await supabase
    .from('teams')
    .select('*')
    .eq('city_id', cityId);

  if (!teams) return { total_extracted: 0, errors: ['No teams found'] };

  let totalExtracted = 0;
  const allErrors: string[] = [];

  for (const team of teams as Team[]) {
    const result = await scrapePromotionsForTeam(team, targetDate);
    totalExtracted += result.extracted;
    allErrors.push(...result.errors.map(e => `${team.short_name}: ${e}`));
  }

  return { total_extracted: totalExtracted, errors: allErrors };
}
