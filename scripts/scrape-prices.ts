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

/**
 * Search TickPick for a team and extract prices + URLs from search results
 */
async function scrapeTeamPrices(teamName: string): Promise<PriceResult[]> {
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    const searchUrl = `https://www.tickpick.com/search?q=${encodeURIComponent(teamName)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    // Try scrolling to load more results
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1000));
    }

    // Extract event links with their text (contains date + price)
    const eventLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/buy-"]'));
      return links.map(a => ({
        href: (a as HTMLAnchorElement).href,
        text: (a as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      }));
    });

    const results: PriceResult[] = [];
    const months: Record<string, string> = {
      JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
      JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
    };

    for (const link of eventLinks) {
      // Parse: "APR 14 TUE Detroit Tigers vs. Kansas City Royals Comerica Park - Detroit, MI From $10+"
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

  for (const price of prices) {
    // Widen window to cover timezone offsets (local date → UTC can shift by up to +14h)
    const dayStart = `${price.eventDate}T00:00:00.000Z`;
    const nextDay = new Date(price.eventDate + 'T00:00:00Z');
    nextDay.setDate(nextDay.getDate() + 1);
    const dayEnd = `${nextDay.toISOString().split('T')[0]}T12:00:00.000Z`;

    // Find matching home game
    const { data: games } = await supabase
      .from('games')
      .select('id')
      .eq('home_team_id', teamId)
      .gte('start_time', dayStart)
      .lte('start_time', dayEnd)
      .limit(1);

    if (!games || games.length === 0) continue;

    const gameId = games[0].id;

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
  let query = supabase.from('teams').select('id, name, short_name, city_id');

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

    const prices = await scrapeTeamPrices(team.name);
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
