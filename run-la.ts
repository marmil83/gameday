import * as fs from 'fs';
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const i = line.indexOf('='); if (i > 0) {
    const key = line.slice(0, i).trim(); const val = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

(async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: city } = await supabase.from('cities').select('id, name').ilike('name', 'Los Angeles').single();
  if (!city) { console.error('no LA city'); process.exit(1); }
  console.log(`[run-la] City: ${city.name} (${city.id})`);
  const { runPipelineForCity } = await import('./src/lib/pipeline/orchestrator');
  const t0 = Date.now();
  const result = await runPipelineForCity(city.id);
  console.log(`[run-la] Completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(JSON.stringify(result, null, 2));
})().catch(err => { console.error('Fatal:', err); process.exit(1); });
