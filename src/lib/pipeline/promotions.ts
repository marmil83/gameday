// Promotion Scraping Pipeline
// Scrapes official team promo pages and uses AI to extract structured data

import * as cheerio from 'cheerio';
import { createServiceClient } from '../supabase/server';
import { extractPromotions } from '../ai/claude';
import type { Team } from '@/types/database';

/**
 * Scrape text content from a URL, optionally focused around a target date
 * so we don't waste Claude's output budget on past results that appear
 * earlier on the page (e.g. AHL/MiLB sites render the full season).
 */
async function scrapePageText(url: string, targetDate?: string): Promise<string | null> {
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
    const fullText = $('main, article, .content, .promotions, .promos, [class*="promo"], body')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();

    // Date-aware slicing: if we know the target date, find where it (or a
    // nearby date) appears in the text and grab a generous window around
    // it. This is critical for sites like griffinshockey.com that render
    // the entire ~160k-char season including past results — without
    // focusing, Claude exhausts its output budget on October games before
    // reaching the May playoff dates the caller actually asked about.
    if (targetDate) {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      const monthAbbrevs = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const [, monthStr, dayStr] = targetDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
      const month = parseInt(monthStr ?? '0', 10);
      const day = parseInt(dayStr ?? '0', 10);
      if (month >= 1 && month <= 12) {
        // Try several formats teams use: "May 9", "May 09", "5/9", "5-9"
        const monthName = monthNames[month - 1];
        const monthAbbrev = monthAbbrevs[month - 1];
        const candidates: RegExp[] = [
          new RegExp(`\\b${monthName}\\s+${day}\\b`, 'i'),
          new RegExp(`\\b${monthName}\\s+0?${day}\\b`, 'i'),
          new RegExp(`\\b${monthAbbrev}\\.?\\s+${day}\\b`, 'i'),
          new RegExp(`\\b${month}/${day}\\b`),
          new RegExp(`\\b${month}-${day}\\b`),
        ];
        let hitIdx = -1;
        for (const re of candidates) {
          const m = fullText.search(re);
          if (m >= 0) { hitIdx = m; break; }
        }
        if (hitIdx >= 0) {
          // Window: ~10k chars before, 30k after (most upcoming-game lists
          // continue forward chronologically, so more after than before).
          const start = Math.max(0, hitIdx - 10_000);
          const end = Math.min(fullText.length, hitIdx + 30_000);
          return fullText.slice(start, end);
        }
      }
    }

    // No target date or no match — fall back to a generous head slice.
    return fullText.slice(0, 200000);
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

  // OPTIMIZATION: query for matching home games FIRST (cheap, just DB),
  // and bail before doing any expensive work if nothing matches. The
  // pipeline scrapes 7 dates × all teams twice daily; most team-date
  // combos don't have a game on the target date. Previously we were
  // running an HTTP fetch + AI call for every empty combo. This guard
  // alone cuts ~60-70% of Anthropic spend.
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
  // local calendar day. Promo pages display dates as the team writes them
  // (always local), so matching must happen in the team's TZ.
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

  // Early exit — saves the HTTP fetch and the AI call.
  if (games.length === 0) {
    return { extracted: 0, errors: [] };
  }

  // Now do the expensive work: scrape the page and call the AI.
  const rawText = await scrapePageText(team.promo_page_url, targetDate);
  if (!rawText) {
    return { extracted: 0, errors: [`Failed to scrape ${team.promo_page_url}`] };
  }

  const promotions = await extractPromotions(rawText, team.name, targetDate);

  // Make this scrape IDEMPOTENT — wipe any prior AI-extracted promos for
  // these games before writing fresh ones. Without this, every twice-daily
  // scrape was appending duplicates AND stale data from buggy past runs
  // (e.g. dates Claude attributed wrong) lingered forever. Admin-verified
  // promos are preserved.
  //
  // NB: select-then-delete-by-id pattern. Combining `.in('game_id', [...])`
  // with `.eq()` boolean filters in a single .delete() chain silently
  // matched 0 rows in our Supabase build — likely a PostgREST quirk with
  // multi-condition deletes. Selecting first sidesteps it.
  const matchedGameIds = games.map(g => g.id);
  const { data: stale } = await supabase
    .from('promotions')
    .select('id')
    .in('game_id', matchedGameIds)
    .eq('is_ai_extracted', true)
    .eq('is_admin_verified', false);
  for (const row of stale || []) {
    const { error: delErr } = await supabase.from('promotions').delete().eq('id', row.id);
    if (delErr) errors.push(`Failed to clear promo ${row.id}: ${delErr.message}`);
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
