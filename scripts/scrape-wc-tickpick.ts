// Scrape TickPick's 2026 World Cup catalog for per-match pricing.
//
// SeatGeek's API doesn't surface WC pricing (FIFA-controlled primary
// sales, thin secondary inventory aggregation). TickPick does — their
// /soccer/world-cup-soccer-tickets/ page lists every WC match with a
// "From $N" floor and a per-event /buy-...match-NN-... URL.
//
// Each TickPick URL embeds the FIFA match number (e.g. "match-07"),
// which is the same identifier we used for source_event_id in the seed
// ("fifa-wc-m07"). So matching scraped rows back to our games is a
// regex extract on the URL slug — no team-name fuzz needed.
//
// Saves pricing_snapshots rows with source_name='tickpick' and the
// per-event URL on affiliate_url, so the GameCard's TickPick row
// shows live ALL-IN pricing. NOTE: the click-through is downgraded to
// the team-page URL elsewhere in the UI (see commit 12d53e4); per-event
// URLs trigger TickPick's bot defense. The scraped per-event URL is
// kept as data for future use if their stance changes.
//
// Usage:
//   npx tsx scripts/scrape-wc-tickpick.ts

import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
import { createClient } from '@supabase/supabase-js';
import * as cheerio from 'cheerio';
import { getBrowser, closeBrowserPool } from '../src/lib/pipeline/promotions';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const CATALOG_URL = 'https://www.tickpick.com/soccer/world-cup-soccer-tickets/';

interface WCPrice {
  matchNum: string;       // e.g. "07" — zero-padded to match our source_event_id
  lowestPrice: number;
  tickpickUrl: string;
}

async function scrapeCatalog(): Promise<WCPrice[]> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');

  await page.goto(CATALOG_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // The WC catalog page lazy-loads matches in batches as you scroll —
  // 4 quick scrolls only surfaced ~11 of 104 events. Scroll until either
  // the page stops getting taller OR we've made a generous max attempts,
  // pausing between each scroll for the next batch to render.
  let lastHeight = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise(r => setTimeout(r, 1_200));
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
  }

  const html = await page.content();
  await page.close().catch(() => {});

  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: WCPrice[] = [];

  $('a[href*="/buy-"]').each((_i, el) => {
    const hrefRaw = $(el).attr('href') || '';
    const href = hrefRaw.startsWith('http') ? hrefRaw : `https://www.tickpick.com${hrefRaw}`;
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    // Match number lives in the URL slug, e.g. "/buy-fifa-world-cup-26-…-match-07-…/"
    // Capture the digits so we can map to fifa-wc-m{N} later.
    const matchM = href.match(/-match-(\d+)-/i);
    if (!matchM) return;
    const matchNum = matchM[1].padStart(2, '0');

    // "From $N" floor — present on every priced row. Missing means
    // TickPick has the event listed but no inventory yet; skip.
    const priceM = text.match(/From \$(\d+)\+?/);
    if (!priceM) return;
    const lowestPrice = parseInt(priceM[1], 10);

    const key = `${matchNum}:${href}`;
    if (seen.has(key)) return;
    seen.add(key);

    out.push({ matchNum, lowestPrice, tickpickUrl: href });
  });

  return out;
}

async function main() {
  console.log(`Fetching ${CATALOG_URL} …`);
  let prices: WCPrice[];
  try {
    prices = await scrapeCatalog();
  } finally {
    await closeBrowserPool();
  }

  console.log(`Parsed ${prices.length} priced match rows from TickPick\n`);

  // Lookup our seeded WC games by source_event_id, build a map of
  // matchNum → game so the price write is one quick join.
  const { data: games } = await sb
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

    // Replace any prior TickPick snapshot for this game (idempotent rerun).
    await sb.from('pricing_snapshots')
      .delete()
      .eq('game_id', game.id)
      .eq('source_name', 'tickpick');

    const { error } = await sb.from('pricing_snapshots').insert({
      game_id:              game.id,
      source_name:          'tickpick',
      lowest_price:         p.lowestPrice,
      displayed_price:      p.lowestPrice,
      base_price:           p.lowestPrice,
      pricing_transparency: 'all_in',
      affiliate_url:        p.tickpickUrl,
      captured_at:          new Date().toISOString(),
    });

    if (error) {
      console.error(`  ✗ m${p.matchNum} (${game.home_team_name} vs ${game.away_team_name}):`, error.message);
      continue;
    }
    console.log(`  ✓ m${p.matchNum} ${game.home_team_name} vs ${game.away_team_name} — $${p.lowestPrice}`);
    saved++;
  }

  console.log(`\nSaved ${saved} TickPick snapshots, skipped ${skipped} (no matching DB game).`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
