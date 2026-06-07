// Manual WC pricing/affiliate-URL attacher.
//
// Backfills SeatGeek per-event affiliate URLs (and live prices when SG
// has them — usually weeks-out the events are listed without a price)
// onto our seeded FIFA-WC games.
//
// Run after seeding the WC games once, and re-run any time SG ticks up
// their data:
//
//   npx tsx scripts/attach-wc-pricing.ts
//
// Idempotent — each match's affiliate_url is upserted and the pricing
// snapshot is replaced (delete + insert keyed on game_id + source_name)
// so running it twice doesn't double-write.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { attachWCPricingForCity } from '../src/lib/pipeline/espn-events';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  // Only the cities that actually host WC matches in this seed.
  const { data: cities, error } = await supabase
    .from('cities')
    .select('id, name')
    .in('name', ['New York', 'Los Angeles']);

  if (error || !cities?.length) {
    console.error('Failed to load WC host cities:', error);
    process.exit(1);
  }

  for (const c of cities) {
    const result = await attachWCPricingForCity(c.id);
    console.log(`${c.name.padEnd(12)} matched=${result.matched} skipped=${result.skipped}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
