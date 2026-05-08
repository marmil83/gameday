// Full pipeline orchestrator — runs all update steps in order
// Usage: npx tsx scripts/pipeline.ts [--with-ai]
//
// Default (no AI):  standings → prices → rescore     (zero tokens)
// With --with-ai:   standings → prices → promos → enrich  (uses tokens)
//
// Schedule this to run on a regular cadence:
//   Default:   every 4-6 hours (free, no tokens)
//   With AI:   once daily or when new games are added

import { execSync } from 'child_process';
import path from 'path';

const projectRoot = path.resolve(__dirname, '..');
const withAI = process.argv.includes('--with-ai');

function run(label: string, script: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${label}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    execSync(`npx tsx scripts/${script}`, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
      timeout: 300_000, // 5 min max per step
    });
  } catch (err) {
    console.error(`\n[PIPELINE] ${label} failed, continuing...\n`);
  }
}

async function main() {
  const startTime = Date.now();
  console.log(`\nFoamfinger Pipeline — ${new Date().toLocaleString()}`);
  console.log(`Mode: ${withAI ? 'FULL (with AI — tokens will be used)' : 'SCORE-ONLY (no tokens)'}\n`);

  // Step 1: Fetch latest standings (free APIs)
  run('Fetching standings', 'fetch-standings.ts');

  // Step 2: Scrape latest prices (Puppeteer, no tokens)
  run('Scraping prices', 'scrape-prices.ts');

  if (withAI) {
    // Step 3a: Scrape promos (Puppeteer + Claude — uses tokens)
    run('Scraping promotions', 'scrape-promos.ts');

    // Step 4a: Full AI enrichment (uses tokens)
    run('AI Enrichment', 'enrich.ts --force');
  } else {
    // Step 3b: Rescore only (pure math + weather API, no tokens)
    run('Rescoring games', 'rescore.ts');
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Pipeline complete in ${elapsed}s`);
  console.log(`  Tokens used: ${withAI ? 'YES' : 'NONE'}`);
  console.log(`${'='.repeat(60)}\n`);
}

main();
