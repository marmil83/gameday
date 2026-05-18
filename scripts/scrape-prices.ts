// Manual TickPick price scraper.
//
// As of c0aee21 the scraping logic lives in src/lib/pipeline/tickpick.ts
// and runs automatically via the /api/pipeline/scrape-tickpick cron
// (per-city, 1× daily). This script remains as a manual escape hatch:
// run it when you've just added games / a new city / want to force a
// price refresh without waiting for the next cron tick.
//
// Usage:
//   npx tsx scripts/scrape-prices.ts                 # all active cities
//   npx tsx scripts/scrape-prices.ts --city=detroit  # one city by name (substring match)

import { createClient } from '@supabase/supabase-js';
import { scrapeTickPickForCity } from '../src/lib/pipeline/tickpick';
import { closeBrowserPool } from '../src/lib/pipeline/promotions';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const cityArg = process.argv.find(a => a.startsWith('--city='))?.split('=')[1]
    || (process.argv.includes('--city') ? process.argv[process.argv.indexOf('--city') + 1] : null);

  let query = supabase.from('cities').select('id, name').eq('is_active', true);
  if (cityArg) query = query.ilike('name', `%${cityArg}%`);

  const { data: cities, error } = await query;
  if (error || !cities || cities.length === 0) {
    console.error(`No matching cities${cityArg ? ` for "${cityArg}"` : ''}.`);
    process.exit(1);
  }

  console.log(`Scraping TickPick for ${cities.length} city/cities: ${cities.map(c => c.name).join(', ')}\n`);

  try {
    let total = 0;
    for (const city of cities) {
      console.log(`\n--- ${city.name} ---`);
      const r = await scrapeTickPickForCity(city.id);
      console.log(`${city.name}: ${r.teams_scraped} teams scraped, ${r.prices_saved} prices saved, ${r.errors.length} errors`);
      total += r.prices_saved;
    }
    console.log(`\nTotal: ${total} prices saved across ${cities.length} city/cities.`);
  } finally {
    await closeBrowserPool();
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
