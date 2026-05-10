// Scrape ticket prices from TickPick (all-in pricing, no hidden fees)
// Extracts both pricing AND event URLs so the CTA links match the displayed price
// Usage: npx tsx scripts/scrape-prices.ts [--city detroit|portland]

import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface PriceResult {
  lowestPrice: number;
  eventDate: string; // YYYY-MM-DD
  tickpickUrl: string;
}

// Map league → TickPick league slug
const TICKPICK_LEAGUE_SLUGS: Record<string, string> = {
  NBA: 'nba', NHL: 'nhl', MLB: 'mlb', NFL: 'nfl',
  MLS: 'mls', NWSL: 'nwsl', WNBA: 'wnba',
  AHL: 'ahl', 'MiLB-AAA': 'milb', 'MiLB-AA': 'milb', 'MiLB-A+': 'milb',
};

/**
 * Convert team name to TickPick team page slug.
 * "Detroit Pistons" → "detroit-pistons"
 * "LA Clippers" → "la-clippers"
 */
function toTickPickSlug(teamName: string): string {
  return teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Build the TickPick team page URL.
 * Primary: /nba/detroit-pistons-tickets/
 * Falls back to search if league not mapped.
 */
function buildTickPickUrl(teamName: string, league: string): string {
  const leagueSlug = TICKPICK_LEAGUE_SLUGS[league];
  if (leagueSlug) {
    return `https://www.tickpick.com/${leagueSlug}/${toTickPickSlug(teamName)}-tickets/`;
  }
  return `https://www.tickpick.com/search?q=${encodeURIComponent(teamName)}`;
}

/**
 * Extract priced event links from a TickPick page (team page or search).
 * Handles both text formats:
 *   Search:    "MAY 03 SUN Detroit Pistons vs. Magic ... From $184+"
 *   Team page: "MAY 03 SUN Rnd 1: Pistons vs. Magic - Game 7 3:30pm ... From $184+ Hot Event"
 */
function parseEventLinks(links: { href: string; text: string }[]): PriceResult[] {
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  };
  const results: PriceResult[] = [];
  for (const link of links) {
    const dateMatch = link.text.match(/^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{1,2})\s/);
    const priceMatch = link.text.match(/From \$(\d+)\+?/);
    if (dateMatch && priceMatch) {
      const month = months[dateMatch[1]];
      const day = dateMatch[2].padStart(2, '0');
      results.push({
        lowestPrice: parseInt(priceMatch[1]),
        eventDate: `2026-${month}-${day}`,
        tickpickUrl: link.href,
      });
    }
  }
  return results;
}

/**
 * Scrape TickPick for a team. Tries the team page first (catches same-day and
 * future games), then falls back to the search page if the team page 404s or
 * returns no results.
 */
async function scrapeTeamPrices(teamName: string, league: string): Promise<PriceResult[]> {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const extractLinks = async (): Promise<{ href: string; text: string }[]> => {
      // Scroll to lazy-load more events
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await new Promise(r => setTimeout(r, 800));
      }
      return page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href*="/buy-"]')).map(a => ({
          href: (a as HTMLAnchorElement).href,
          text: (a as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
        }))
      );
    };

    // 1. Try team page first — shows same-day games that search omits
    const teamPageUrl = buildTickPickUrl(teamName, league);
    await page.goto(teamPageUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    let links = await extractLinks();
    let results = parseEventLinks(links);

    // 2. Fall back to search if team page gave nothing
    if (results.length === 0) {
      const searchUrl = `https://www.tickpick.com/search?q=${encodeURIComponent(teamName)}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 1500));
      links = await extractLinks();
      results = parseEventLinks(links);
    }

    return results;
  } catch (error) {
    console.error(`  Failed to scrape prices for ${teamName}:`, error);
    return [];
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Save pricing snapshots and update game affiliate URLs
 */
async function savePricing(teamId: string, prices: PriceResult[]): Promise<number> {
  let saved = 0;

  // TickPick lists events in the team's LOCAL date. Matching by raw UTC
  // window collides on doubleheader-style schedules — e.g. Dodgers Sat
  // 6pm PT (May 10 UTC) and Sun 1pm PT (May 10 UTC) both fall in the
  // same UTC day, so a window-based match would resolve both TickPick
  // entries to the same DB row. We match on local date instead.
  const { data: teamRow } = await supabase
    .from('teams')
    .select('city_id, cities!inner(timezone)')
    .eq('id', teamId)
    .single();
  const tz = ((teamRow as unknown as { cities?: { timezone?: string } })?.cities?.timezone) || 'America/Los_Angeles';
  const localDateOf = (utcIso: string) => new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(utcIso));

  for (const price of prices) {
    // Pull a generous ±36h window of candidate games, then filter to those
    // whose LOCAL date matches the TickPick eventDate exactly. Handles all
    // timezone offsets without losing precision.
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

    // Delete old snapshots for this game/source and insert fresh
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

    if (error) {
      console.error(`  DB error for ${price.eventDate}: ${error.message}`);
      continue;
    }

    // Update the game's affiliate_url to TickPick so "Get Tickets" links to the right place
    await supabase
      .from('games')
      .update({ affiliate_url: price.tickpickUrl })
      .eq('id', gameId);

    saved++;
  }

  return saved;
}

async function main() {
  const cityArg = process.argv.find(a => a.startsWith('--city='))?.split('=')[1]
    || (process.argv.includes('--city') ? process.argv[process.argv.indexOf('--city') + 1] : null);

  // Get teams
  let query = supabase.from('teams').select('id, name, short_name, city_id, league');

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

  console.log(`Scraping prices for ${teams.length} teams\n`);

  let totalSaved = 0;

  for (const team of teams) {
    console.log(`[${team.short_name}] ${team.name}`);

    const prices = await scrapeTeamPrices(team.name, team.league);
    console.log(`  Found ${prices.length} events with pricing`);

    if (prices.length > 0) {
      prices.slice(0, 5).forEach(p => console.log(`    ${p.eventDate}: $${p.lowestPrice} → ${p.tickpickUrl.slice(0, 80)}...`));
      if (prices.length > 5) console.log(`    ... and ${prices.length - 5} more`);

      const saved = await savePricing(team.id, prices);
      console.log(`  Saved ${saved} pricing snapshots (+ updated affiliate URLs)`);
      totalSaved += saved;
    }

    console.log('');
  }

  console.log(`Done! Saved ${totalSaved} pricing snapshots total.`);
}

main();
