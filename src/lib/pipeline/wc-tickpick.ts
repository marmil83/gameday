// 2026 FIFA World Cup TickPick scraper — pipeline module form.
//
// Cron-callable version of scripts/scrape-wc-tickpick.ts. SeatGeek's API
// returns null pricing for WC events; TickPick has actual inventory.
// We scrape their /soccer/world-cup-soccer-tickets/ catalog page once or
// twice a day and write per-match pricing_snapshots so the cards show
// real ALL-IN prices.
//
// The puppeteer cost is significant (~3-5s launch + scroll loop ~30s)
// so this runs on its own cron schedule — NOT inline with the 4×/day
// refresh-pricing path, which needs to stay fast enough for Vercel's
// serverless budget. Designed to share the existing getBrowser() pool
// so chaining additional scrapers in the same invocation reuses Chrome.

import * as cheerio from 'cheerio';
import { createServiceClient } from '@/lib/supabase/server';
import { getBrowser } from '@/lib/pipeline/promotions';

const CATALOG_URL = 'https://www.tickpick.com/soccer/world-cup-soccer-tickets/';

interface WCPrice {
  matchNum: string;
  lowestPrice: number;
  tickpickUrl: string;
}

async function scrapeCatalog(): Promise<WCPrice[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');

  try {
    await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // Lazy-load the full catalog. Scroll until the page stops growing
    // or we hit a generous cap. Without aggressive scroll only the
    // first ~4 matches surface.
    let lastHeight = 0;
    for (let i = 0; i < 30; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1_200));
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === lastHeight) break;
      lastHeight = newHeight;
    }

    const html = await page.content();
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const out: WCPrice[] = [];

    $('a[href*="/buy-"]').each((_i, el) => {
      const hrefRaw = $(el).attr('href') || '';
      const href = hrefRaw.startsWith('http') ? hrefRaw : `https://www.tickpick.com${hrefRaw}`;
      const text = $(el).text().replace(/\s+/g, ' ').trim();

      const matchM = href.match(/-match-(\d+)-/i);
      if (!matchM) return;
      const matchNum = matchM[1].padStart(2, '0');

      const priceM = text.match(/From \$(\d+)\+?/);
      if (!priceM) return;
      const lowestPrice = parseInt(priceM[1], 10);

      const key = `${matchNum}:${href}`;
      if (seen.has(key)) return;
      seen.add(key);

      out.push({ matchNum, lowestPrice, tickpickUrl: href });
    });

    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function scrapeWCTickPick(): Promise<{
  parsed: number;
  saved: number;
  skipped: number;
}> {
  const supabase = createServiceClient();
  const prices = await scrapeCatalog();

  const { data: games } = await supabase
    .from('games')
    .select('id, source_event_id, home_team_name, away_team_name')
    .eq('source', 'manual-wc-2026');
  const byMatch = new Map<string, { id: string; home_team_name: string; away_team_name: string }>();
  for (const g of games ?? []) {
    const m = g.source_event_id?.match(/m(\d+)$/);
    if (m) byMatch.set(m[1].padStart(2, '0'), g);
  }

  let saved = 0;
  let skipped = 0;
  for (const p of prices) {
    const game = byMatch.get(p.matchNum);
    if (!game) { skipped++; continue; }

    await supabase.from('pricing_snapshots')
      .delete()
      .eq('game_id', game.id)
      .eq('source_name', 'tickpick');

    const { error } = await supabase.from('pricing_snapshots').insert({
      game_id:              game.id,
      source_name:          'tickpick',
      lowest_price:         p.lowestPrice,
      displayed_price:      p.lowestPrice,
      base_price:           p.lowestPrice,
      pricing_transparency: 'all_in',
      affiliate_url:        p.tickpickUrl,
      captured_at:          new Date().toISOString(),
    });

    if (error) { console.error(`[WC TickPick] m${p.matchNum}:`, error.message); continue; }
    saved++;
  }

  return { parsed: prices.length, saved, skipped };
}
