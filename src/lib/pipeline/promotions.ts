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
 * Browser pool. The first puppeteer-rendered URL in a pipeline run
 * launches Chrome; every subsequent URL reuses the same instance,
 * just opening a fresh page. Cuts ~3-5s off each non-first launch.
 *
 * `closeBrowserPool()` is called at the end of each pipeline run by
 * the orchestrator so we don't leak a Chrome process between runs in
 * a long-lived environment (local dev). On Vercel each invocation
 * gets a fresh Node process, so leaking would self-resolve, but we
 * close explicitly anyway — keeps memory usage predictable.
 */
type PuppeteerBrowser = Awaited<ReturnType<Awaited<ReturnType<typeof loadPuppeteer>>['launch']>>;
let browserPromise: Promise<PuppeteerBrowser> | null = null;

async function loadPuppeteer() {
  const puppeteerMod = await import('puppeteer-extra');
  const stealthMod = await import('puppeteer-extra-plugin-stealth');
  const puppeteer = puppeteerMod.default;
  const Stealth = stealthMod.default;
  // .use() is idempotent — calling it on every load is fine.
  puppeteer.use(Stealth());
  return puppeteer;
}

async function getBrowser(): Promise<PuppeteerBrowser> {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    const puppeteer = await loadPuppeteer();
    const chromiumMod = await import('@sparticuz/chromium');
    const chromium = chromiumMod.default;
    const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    console.log(`[Promo Scrape] Launching browser (serverless=${isServerless})`);
    return await puppeteer.launch({
      args: isServerless ? chromium.args : ['--no-sandbox', '--disable-setuid-sandbox'],
      defaultViewport: { width: 1280, height: 800 },
      executablePath: isServerless ? await chromium.executablePath() : undefined,
      headless: true,
    });
  })();
  return browserPromise;
}

export async function closeBrowserPool(): Promise<void> {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try {
    const browser = await p;
    await browser.close();
    console.log('[Promo Scrape] Browser pool closed');
  } catch (err) {
    console.warn('[Promo Scrape] Browser close failed:', err);
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
  let page: Awaited<ReturnType<PuppeteerBrowser['newPage']>> | null = null;
  try {
    const browser = await getBrowser();
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
    // domcontentloaded + a generous fixed post-wait, NOT networkidle2.
    // MLB.com has continuous background telemetry that prevents
    // networkidle from ever firing within the 30s timeout (Angels
    // schedule page reliably times out, Tigers got lucky). The post-wait
    // is what actually matters — React paints the promo schedule grid
    // a beat after DOMContentLoaded, and 3-4s is empirically enough for
    // every page we've tested.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise(r => setTimeout(r, 4000));
    return await page.content();
  } catch (err) {
    console.error(`[Promo Scrape] Puppeteer error on ${url}:`, err);
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
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
 * Scrape + extract promotions for a team across MULTIPLE target dates
 * in a single pass.
 *
 * The previous per-date implementation hit two compounding problems:
 *   1. Haiku is stochastic — given the same source text, two calls for
 *      different target dates returned different sets. A "313 Value
 *      Game" the model captured cleanly for Wed May 20 was silently
 *      missed when the call asked specifically about Tue May 19, even
 *      though both dates' content was in the same page.
 *   2. Cost: 5 dates × per-team puppeteer launches × per-team Haiku
 *      calls = a lot of wasted work for source pages that change at
 *      most twice a day.
 *
 * Now: scrape the page(s) ONCE per team per pipeline run, call Haiku
 * ONCE for the whole window, then dispatch the returned promos to
 * matching games by date. Cuts the per-team API cost ~5×, and Haiku
 * sees every date in the window at once so the "missed item on one
 * date but caught on another" inconsistency disappears.
 *
 * Per-date wipe-and-rewrite safety from the previous fix is preserved:
 * a date with zero extracted promos keeps its existing rows rather
 * than getting wiped.
 */
export async function scrapePromotionsForTeam(
  team: Team,
  targetDates: string[] // YYYY-MM-DD, sorted ascending
): Promise<{
  extracted: number;
  errors: string[];
}> {
  const supabase = createServiceClient();
  const errors: string[] = [];

  if (!team.promo_page_url) {
    return { extracted: 0, errors: ['No promo page URL configured'] };
  }
  if (targetDates.length === 0) {
    return { extracted: 0, errors: [] };
  }

  // OPTIMIZATION: pull all home games in the entire window in a single
  // query, then filter by city-local date. Skip the rest if no game
  // exists on any of the target dates — avoids puppeteer + AI for empty
  // weeks.
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

  // Window: first target date - 36h to last target date + 36h. The
  // ±36h cushion covers timezone edge cases and game-day cross-overs.
  const firstDateMs = new Date(`${targetDates[0]}T12:00:00Z`).getTime();
  const lastDateMs = new Date(`${targetDates[targetDates.length - 1]}T12:00:00Z`).getTime();
  const windowStart = new Date(firstDateMs - 36 * 3_600_000).toISOString();
  const windowEnd = new Date(lastDateMs + 36 * 3_600_000).toISOString();
  const { data: rawGames } = await supabase
    .from('games')
    .select('id, start_time')
    .eq('home_team_id', team.id)
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd);
  // Index games by their city-local date so we can match each extracted
  // promo to the right game in O(1) without re-querying per date.
  const gamesByDate = new Map<string, string>();
  for (const g of rawGames || []) {
    const d = startTimeToLocalDate(g.start_time);
    if (!gamesByDate.has(d)) gamesByDate.set(d, g.id);
  }
  const datesWithGames = targetDates.filter(d => gamesByDate.has(d));
  if (datesWithGames.length === 0) {
    return { extracted: 0, errors: [] };
  }

  // Promo content for some teams lives across MULTIPLE pages (e.g. MLB
  // split the old single `/tickets/promotions` page into separate
  // `/promotions/giveaways`, `/specials/events`, and `/single-game-tickets`).
  // Support a comma-separated list of URLs in promo_page_url; we fetch
  // each, concatenate the text, and pass the combined corpus to the AI
  // as one block. Single-URL configs (most teams) work unchanged.
  //
  // Slice anchor is the EARLIEST target date so the focused text window
  // extends forward from there and covers every date we care about.
  const urls = team.promo_page_url.split(',').map(u => u.trim()).filter(Boolean);
  const sourceUrl = urls[0];
  const textChunks: string[] = [];
  for (const u of urls) {
    const chunk = await scrapePageText(u, datesWithGames[0]);
    if (chunk) textChunks.push(chunk);
  }
  if (textChunks.length === 0) {
    return { extracted: 0, errors: [`Failed to scrape ${team.promo_page_url}`] };
  }
  const rawText = textChunks.join('\n\n--- next page ---\n\n');

  // ONE Haiku call for the whole window. Reference date is the FIRST
  // target date — the prompt's "±14 days" window covers every other
  // target date naturally.
  const allPromos = await extractPromotions(rawText, team.name, datesWithGames[0]);

  // Bucket extracted promos by their attributed date.
  const promosByDate = new Map<string, typeof allPromos>();
  for (const p of allPromos) {
    if (!p.date) continue; // null-date entries are unverifiable, drop
    const bucket = promosByDate.get(p.date) ?? [];
    bucket.push(p);
    promosByDate.set(p.date, bucket);
  }

  let totalExtracted = 0;
  for (const date of datesWithGames) {
    const matchingPromos = promosByDate.get(date) ?? [];
    const gameId = gamesByDate.get(date)!;

    // SAFETY: only wipe prior AI-extracted rows for this date when we
    // have at least one new row to replace them with. Empty result
    // preserves last-known-good data.
    if (matchingPromos.length > 0) {
      const { data: stale } = await supabase
        .from('promotions')
        .select('id')
        .eq('game_id', gameId)
        .eq('is_ai_extracted', true)
        .eq('is_admin_verified', false);
      for (const row of stale || []) {
        const { error: delErr } = await supabase.from('promotions').delete().eq('id', row.id);
        if (delErr) errors.push(`Failed to clear promo ${row.id}: ${delErr.message}`);
      }
    } else {
      console.log(`[Promo Scrape] ${team.short_name} ${date}: 0 promos extracted — preserving existing rows.`);
    }

    for (const promo of matchingPromos) {
      const { error } = await supabase.from('promotions').insert({
        game_id: gameId,
        source_url: sourceUrl,
        raw_text: rawText.slice(0, 2000),
        promo_type: promo.promo_type,
        promo_item: promo.promo_item,
        promo_description: promo.description,
        special_ticket_required: promo.special_ticket_required,
        eligibility_details: promo.eligibility_details,
        confidence_score: promo.confidence_score,
        is_ai_extracted: true,
        is_admin_verified: false,
      });
      if (error) errors.push(`Failed to insert promo: ${error.message}`);
      else totalExtracted++;
    }
  }

  return { extracted: totalExtracted, errors };
}

/**
 * Scrape promotions for all teams in a city for a window of dates.
 * Each team is scraped + AI-extracted ONCE for the whole window.
 */
export async function scrapePromotionsForCity(
  cityId: string,
  targetDates: string[]
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
    const result = await scrapePromotionsForTeam(team, targetDates);
    totalExtracted += result.extracted;
    allErrors.push(...result.errors.map(e => `${team.short_name}: ${e}`));
  }

  return { total_extracted: totalExtracted, errors: allErrors };
}
