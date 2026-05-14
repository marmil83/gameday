// Promotion Scraping Pipeline
// Scrapes official team promo pages and uses AI to extract structured data

import * as cheerio from 'cheerio';
import { createServiceClient } from '../supabase/server';
import { extractPromotions } from '../ai/claude';
import type { Team } from '@/types/database';

// Hosts whose promo content is rendered client-side by a React app —
// static fetch returns only a hydrating shell with no per-game promo
// text in it. We route these through a headless browser instead.
// Audit-verified: mlb.com, nba.com, detroitlions.com all hit this.
// Add more here as we discover them.
const JS_RENDERED_HOSTS = new Set<string>([
  'www.mlb.com', 'mlb.com',
  'www.nba.com', 'nba.com',
  'www.detroitlions.com', 'detroitlions.com',
]);

function needsBrowserRendering(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return JS_RENDERED_HOSTS.has(host);
  } catch {
    return false;
  }
}

/**
 * Fetch raw HTML via headless Chrome. Used for hosts where the actual
 * promo schedule is hydrated client-side and a static fetch returns
 * only the React app shell (MLB, NBA, NFL — verified empirically).
 *
 * Uses @sparticuz/chromium in production (Vercel serverless) and the
 * locally-installed Chromium in dev. Stealth plugin reduces the chance
 * of bot-detection blocks on big-league sites.
 */
async function fetchHtmlViaBrowser(url: string): Promise<string | null> {
  // Dynamic imports so puppeteer-extra's stealth plugin only loads when
  // we actually need it — keeps the Node cold-start cost on the static
  // path (which handles 80%+ of teams) close to zero.
  const puppeteerMod = await import('puppeteer-extra');
  const stealthMod = await import('puppeteer-extra-plugin-stealth');
  const chromiumMod = await import('@sparticuz/chromium');
  const puppeteer = puppeteerMod.default;
  const Stealth = stealthMod.default;
  const chromium = chromiumMod.default;
  puppeteer.use(Stealth());

  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch({
      args: isServerless ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: isServerless ? await chromium.executablePath() : undefined,
      headless: true,
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
    // Give React a moment to finish hydrating after networkidle fires.
    // 1.5s is empirically enough for MLB's schedule grid; the page's
    // initial paint is usually done by then but post-paint promo
    // annotations sometimes lag by a beat.
    await new Promise(r => setTimeout(r, 1500));
    return await page.content();
  } catch (err) {
    console.error(`[Promo Scrape] Puppeteer error on ${url}:`, err);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Scrape text content from a URL, optionally focused around a target date
 * so we don't waste Claude's output budget on past results that appear
 * earlier on the page (e.g. AHL/MiLB sites render the full season).
 *
 * Routes through a headless browser for hosts in JS_RENDERED_HOSTS;
 * uses a plain HTTP fetch + cheerio for everyone else.
 */
async function scrapePageText(url: string, targetDate?: string): Promise<string | null> {
  try {
    let html: string;
    if (needsBrowserRendering(url)) {
      const rendered = await fetchHtmlViaBrowser(url);
      if (!rendered) return null;
      html = rendered;
    } else {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WorthGoing/1.0)',
        },
      });

      if (!response.ok) {
        console.error(`Failed to scrape ${url}: ${response.status}`);
        return null;
      }

      // Silent-redirect detector: fetch follows redirects automatically, so a
      // promo page that gets retired and 301'd to a generic ticket landing
      // page would otherwise look like a successful scrape with 0 promos
      // extracted — and our idempotent wipe-and-rewrite would clear the
      // prior promos. Log conspicuously so the regression is visible.
      // Example: MLB Tigers `/tickets/promotions` → 301 → `/tickets/single-game-tickets`.
      if (response.url && response.url !== url) {
        console.warn(`[Promo Scrape] URL changed: ${url} → ${response.url} — verify the promo page is still the right one.`);
      }

      html = await response.text();
    }

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

  // Promo content for some teams now lives across MULTIPLE pages (e.g.
  // MLB split the old single `/tickets/promotions` page into separate
  // `/promotions/giveaways` and `/specials/events` subsections — one
  // covers bobbleheads / t-shirts, the other covers theme nights /
  // fireworks / value games). Support a comma-separated list of URLs in
  // promo_page_url; we fetch each, concatenate the text, and pass the
  // combined corpus to the AI as one block. Single-URL configs are the
  // common case and work unchanged.
  const urls = team.promo_page_url.split(',').map(u => u.trim()).filter(Boolean);
  const sourceUrl = urls[0]; // primary URL for persistence + error messages
  const textChunks: string[] = [];
  for (const u of urls) {
    const chunk = await scrapePageText(u, targetDate);
    if (chunk) textChunks.push(chunk);
  }
  if (textChunks.length === 0) {
    return { extracted: 0, errors: [`Failed to scrape ${team.promo_page_url}`] };
  }
  const rawText = textChunks.join('\n\n--- next page ---\n\n');

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
      source_url: sourceUrl,
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
