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
        'User-Agent': 'Mozilla/5.0 (compatible; Foamfinger/1.0)',
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

    // Inline image filenames + alt text into the body text — many promo
    // schedules encode item names in the image (e.g. "MAY-12-DEBUT-PIN.png")
    // and would otherwise be invisible to a text-only scraper.
    $('img').each((_i, el) => {
      const alt = $(el).attr('alt') || '';
      const src = $(el).attr('src') || '';
      const filename = src.split('/').pop()?.replace(/\.(png|jpe?g|webp|svg|gif)$/i, '').replace(/[-_]/g, ' ') || '';
      if (alt || filename) {
        $(el).replaceWith(` [image: ${alt} ${filename}] `);
      }
    });

    // Get main content text
    const text = $('main, article, .content, .promotions, .promos, [class*="promo"], body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // Limit to reasonable length for AI processing.
    // 20k chars covers a full-season promo schedule for most teams without
    // blowing through Claude's context — was previously 8k which truncated
    // mid-season and caused later games to lose their promos silently.
    return text.slice(0, 20000);
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

  // Date matching is done in the team's LOCAL timezone — promo pages display
  // dates as the team writes them (always local), not UTC. Comparing UTC
  // boundaries to a "May 9" local date would mis-match games that start late
  // evening (e.g. 7pm PT = 02:00 UTC next day).
  const { data: city } = await supabase
    .from('cities')
    .select('timezone')
    .eq('id', team.city_id)
    .single();
  const tz = city?.timezone || 'America/New_York';
  const localFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const startTimeToLocalDate = (iso: string) => localFmt.format(new Date(iso));

  // Pull games in a generous ±36h window around targetDate, then filter by
  // the team's local date so we get exactly the games belonging to that
  // local calendar day.
  const targetMs = new Date(`${targetDate}T12:00:00Z`).getTime();
  const windowStart = new Date(targetMs - 36 * 3_600_000).toISOString();
  const windowEnd = new Date(targetMs + 36 * 3_600_000).toISOString();
  const { data: rawGames } = await supabase
    .from('games')
    .select('id, start_time')
    .eq('home_team_id', team.id)
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd);
  const games = (rawGames || []).filter(g => startTimeToLocalDate(g.start_time) === targetDate);

  if (games.length === 0) {
    return { extracted: 0, errors: ['No games found for this date'] };
  }

  let extracted = 0;

  for (const promo of promotions) {
    // Strict date match — protects against AI hallucinations that conflate
    // items across dates. If the AI extracted a date and it doesn't match
    // the target, drop the row. Null dates are also dropped (no way to
    // verify they belong to this game).
    if (promo.date !== targetDate) {
      continue;
    }

    // For MVP, assume one home game per team per day, so the matched game
    // is unambiguous after the date filter.
    const matchedGame = games[0];

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
