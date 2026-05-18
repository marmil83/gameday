// TickPick pricing scraper — pipeline module form.
//
// This is the cron-callable version of scripts/scrape-prices.ts. Same
// extraction logic; structured for per-city invocation so each city can
// fit inside Vercel's 5-min serverless budget, and shares the puppeteer
// browser pool with promotions.ts so we don't pay for a separate
// Chrome launch.
//
// Why TickPick specifically: SeatGeek's free API returns null
// `lowest_price` on most events, so TickPick — which exposes all-in
// (no hidden fees) prices on its public listing pages — is the only
// reliable pricing source for the public card.

import * as cheerio from 'cheerio';
import { createServiceClient } from '../supabase/server';
import { getBrowser, type PuppeteerBrowser } from './promotions';

// Map our `teams.league` value → TickPick's league slug for URL building.
const TICKPICK_LEAGUE_SLUGS: Record<string, string> = {
  NBA: 'nba', NHL: 'nhl', MLB: 'mlb', NFL: 'nfl',
  MLS: 'mls', NWSL: 'nwsl', WNBA: 'wnba',
  AHL: 'ahl', 'MiLB-AAA': 'milb', 'MiLB-AA': 'milb', 'MiLB-A+': 'milb',
};

function toTickPickSlug(teamName: string): string {
  return teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildTeamPageUrl(teamName: string, league: string): string {
  const leagueSlug = TICKPICK_LEAGUE_SLUGS[league];
  if (leagueSlug) {
    return `https://www.tickpick.com/${leagueSlug}/${toTickPickSlug(teamName)}-tickets/`;
  }
  return `https://www.tickpick.com/search?q=${encodeURIComponent(teamName)}`;
}

interface PriceResult {
  lowestPrice: number;
  eventDate: string; // YYYY-MM-DD (team-local date)
  tickpickUrl: string;
}

// Parse the link list extracted from a TickPick listing page.
// Both team-page and search-page link formats use the same prefix
// "<MONTH> <DAY> ... From $<N>+". A handful of league-specific
// variants (playoff round prefixes, "Hot Event" suffix, ALDS/NLDS
// brackets) are caught by the broad regex.
function parseEventLinks(links: { href: string; text: string }[]): PriceResult[] {
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const results: PriceResult[] = [];
  for (const link of links) {
    // TickPick's listing-link text starts with "MONTH-DAY-WEEKDAY" but
    // their CSS-rendered text strips whitespace between them. So a link
    // can read either "MAY 18 MON Tigers vs. Guardians..." (old layout,
    // search page) or "MAY18MONMay 18Mon 6:40 pm..." (current layout,
    // team page). Match both by making the inter-token whitespace
    // optional. The 3-letter weekday after the day disambiguates from
    // any number that happens to follow.
    const dateMatch = link.text.match(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*(\d{1,2})\s*(?:MON|TUE|WED|THU|FRI|SAT|SUN|\s)/);
    const priceMatch = link.text.match(/From \$(\d+)\+?/);
    if (dateMatch && priceMatch) {
      const month = months[dateMatch[1]];
      const day = dateMatch[2].padStart(2, '0');
      // Year inference: TickPick listings only show month/day. We assume
      // the current year for upcoming games. If we're in late Dec and the
      // event is Jan/Feb (e.g. NBA/NHL season crosses year), tick the
      // year forward. This is a heuristic — for season-crossing leagues
      // the scrape window is short enough that misclassification is rare.
      const now = new Date();
      let year = now.getFullYear();
      const eventMonthNum = parseInt(month, 10);
      const nowMonth = now.getMonth() + 1;
      if (nowMonth >= 10 && eventMonthNum <= 3) year += 1;
      results.push({
        lowestPrice: parseInt(priceMatch[1]),
        eventDate: `${year}-${month}-${day}`,
        tickpickUrl: link.href,
      });
    }
  }
  return results;
}

/**
 * Scrape TickPick prices for a single team. Tries the team page first
 * (catches same-day games that the search page omits), falls back to
 * search.
 */
async function scrapeTeamPrices(
  browser: PuppeteerBrowser,
  teamName: string,
  league: string,
): Promise<PriceResult[]> {
  let page: Awaited<ReturnType<PuppeteerBrowser['newPage']>> | null = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');

    const extractLinks = async (): Promise<{ href: string; text: string }[]> => {
      // Scroll to trigger lazy-load of additional events
      for (let i = 0; i < 3; i++) {
        await page!.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 800));
      }
      // Pull HTML out, parse via cheerio — same approach as promotions.ts.
      // The link extraction is structural (a[href*="/buy-"]), so cheerio
      // works just as well as page.evaluate and keeps the same pattern.
      const html = await page!.content();
      const $ = cheerio.load(html);
      const links: { href: string; text: string }[] = [];
      $('a[href*="/buy-"]').each((_i, el) => {
        const href = $(el).attr('href') || '';
        const fullHref = href.startsWith('http') ? href : `https://www.tickpick.com${href}`;
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        links.push({ href: fullHref, text });
      });
      return links;
    };

    // 1. Team page first
    const teamPageUrl = buildTeamPageUrl(teamName, league);
    try {
      await page.goto(teamPageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await new Promise(r => setTimeout(r, 2_000));
    } catch {
      // Navigation timeout / network error — fall through to search
    }

    let links = await extractLinks();
    let results = parseEventLinks(links);

    // 2. Search fallback when team page is empty
    if (results.length === 0) {
      try {
        const searchUrl = `https://www.tickpick.com/search?q=${encodeURIComponent(teamName)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await new Promise(r => setTimeout(r, 2_000));
        links = await extractLinks();
        results = parseEventLinks(links);
      } catch {
        // ignore — return whatever we have
      }
    }

    return results;
  } catch (error) {
    console.error(`[TickPick] ${teamName}:`, error);
    return [];
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/**
 * Save a TickPick price as a pricing_snapshots row + update the game's
 * affiliate URL. Match the TickPick event to a DB game by
 * (home_team_id, team-local date) — NOT raw UTC window, because
 * doubleheader-style schedules in the same UTC day collide.
 */
async function savePricing(teamId: string, prices: PriceResult[]): Promise<number> {
  const supabase = createServiceClient();
  let saved = 0;

  const { data: teamRow } = await supabase
    .from('teams')
    .select('city_id, cities!inner(timezone)')
    .eq('id', teamId)
    .single();
  const tz = ((teamRow as unknown as { cities?: { timezone?: string } })?.cities?.timezone) || 'America/New_York';
  const localDateOf = (utcIso: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(utcIso));

  for (const price of prices) {
    const targetMs = new Date(`${price.eventDate}T12:00:00Z`).getTime();
    const windowStart = new Date(targetMs - 36 * 3_600_000).toISOString();
    const windowEnd = new Date(targetMs + 36 * 3_600_000).toISOString();

    const { data: candidates } = await supabase
      .from('games')
      .select('id, start_time')
      .eq('home_team_id', teamId)
      .gte('start_time', windowStart)
      .lte('start_time', windowEnd)
      .order('start_time');

    const matched = (candidates || []).find(g => localDateOf(g.start_time) === price.eventDate);
    if (!matched) continue;

    const gameId = matched.id;

    // Delete old TickPick snapshots for this game and insert fresh.
    // Idempotent — re-runs replace prior pricing instead of appending.
    await supabase
      .from('pricing_snapshots')
      .delete()
      .eq('game_id', gameId)
      .eq('source_name', 'tickpick');

    const { error } = await supabase.from('pricing_snapshots').insert({
      game_id: gameId,
      source_name: 'tickpick',
      lowest_price: price.lowestPrice,
      displayed_price: price.lowestPrice,
      pricing_transparency: 'all_in_verified',
      affiliate_url: price.tickpickUrl,
      captured_at: new Date().toISOString(),
    });
    if (error) continue;

    // Promote TickPick URL to the game's primary affiliate link so the
    // card's "Get Tickets" CTA matches the displayed price.
    await supabase.from('games').update({ affiliate_url: price.tickpickUrl }).eq('id', gameId);

    saved++;
  }

  return saved;
}

/**
 * Scrape TickPick prices for every team in a city. Designed for
 * cron-driven per-city invocation. Returns counts so the route can
 * report status.
 */
export async function scrapeTickPickForCity(cityId: string): Promise<{
  teams_scraped: number;
  prices_saved: number;
  errors: string[];
}> {
  const supabase = createServiceClient();
  const errors: string[] = [];
  let teamsScraped = 0;
  let totalSaved = 0;

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name, league')
    .eq('city_id', cityId);

  if (!teams || teams.length === 0) {
    return { teams_scraped: 0, prices_saved: 0, errors: ['No teams found for city'] };
  }

  const browser = await getBrowser();

  for (const team of teams) {
    try {
      const prices = await scrapeTeamPrices(browser, team.name, team.league);
      if (prices.length === 0) {
        console.log(`[TickPick] ${team.name}: 0 events on TickPick`);
        continue;
      }
      const saved = await savePricing(team.id, prices);
      console.log(`[TickPick] ${team.name}: ${prices.length} events found, ${saved} matched/saved`);
      totalSaved += saved;
      teamsScraped++;
    } catch (err) {
      errors.push(`${team.name}: ${(err as Error).message}`);
    }
  }

  return { teams_scraped: teamsScraped, prices_saved: totalSaved, errors };
}
