// Standalone promo scraper for GitHub Actions.
//
// Why this exists: MLB / NBA / NFL promo pages are JavaScript-rendered,
// so scraping them needs a real headless browser (puppeteer). That works
// on a GitHub Actions ubuntu runner (real Chrome) but FAILS on Vercel's
// serverless environment (@sparticuz/chromium) — which silently broke
// the Tigers/Yankees/Mets/Angels promo scrape on every cron run. This
// script moves all promo scraping to GitHub Actions where the browser
// is reliable. The Vercel pipeline no longer attempts promo scraping
// (gated by VERCEL env in the orchestrator).
//
// Thin wrapper around the pipeline's scrapePromotionsForCity — single
// source of truth for the multi-URL handling, date-windowed slicing,
// idempotent wipe-and-replace, and timezone-aware game matching. (The
// previous version of this file was a diverged copy that only scraped
// the first of a team's comma-separated URLs — it would have missed
// Tigers promos entirely.)
//
// Usage:
//   npx tsx scripts/scrape-promos.ts                 # all active cities
//   npx tsx scripts/scrape-promos.ts --city=detroit  # one city (substring)

import { createClient } from '@supabase/supabase-js';
import { scrapePromotionsForCity, closeBrowserPool } from '../src/lib/pipeline/promotions';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Next-5-days window in a city's local timezone — promo pages list dates
// as the team writes them (always local), so target dates must be in the
// same frame. Mirrors the orchestrator's window logic.
function targetDatesForTz(timezone: string): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const dates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dates.push(fmt.format(d));
  }
  return dates;
}

async function main() {
  const cityArg = process.argv.find(a => a.startsWith('--city='))?.split('=')[1]
    || (process.argv.includes('--city') ? process.argv[process.argv.indexOf('--city') + 1] : null);

  let query = supabase.from('cities').select('id, name, timezone').eq('is_active', true);
  if (cityArg) query = query.ilike('name', `%${cityArg}%`);

  const { data: cities, error } = await query;
  if (error || !cities || cities.length === 0) {
    console.error(`No matching active cities${cityArg ? ` for "${cityArg}"` : ''}.`);
    process.exit(1);
  }

  console.log(`Scraping promotions for ${cities.length} city/cities: ${cities.map(c => c.name).join(', ')}\n`);

  let total = 0;
  const allErrors: string[] = [];
  try {
    for (const city of cities) {
      const tz = city.timezone || 'America/New_York';
      const dates = targetDatesForTz(tz);
      console.log(`\n--- ${city.name} (${dates[0]} → ${dates[dates.length - 1]}) ---`);
      const r = await scrapePromotionsForCity(city.id, dates);
      console.log(`${city.name}: ${r.total_extracted} promos extracted, ${r.errors.length} errors`);
      for (const e of r.errors) console.log(`  err: ${e}`);
      total += r.total_extracted;
      allErrors.push(...r.errors);
    }
  } finally {
    await closeBrowserPool();
  }

  console.log(`\nDone. ${total} promos extracted across ${cities.length} city/cities, ${allErrors.length} errors.`);
  // Exit 0 even with per-team scrape errors — partial success is normal
  // (some teams have no promo page, some sites are transiently down). The
  // workflow shouldn't go red over one flaky team page.
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
