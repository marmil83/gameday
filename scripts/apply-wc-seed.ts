// One-shot WC seed applier — mirrors supabase/seed/002_world_cup.sql but
// runs through the supabase-js client (PostgREST) instead of requiring
// the SQL editor. The seed file stays the source of truth for anyone
// pasting it manually; this is the equivalent path for running it from
// the repo without DB-password access.
//
// Idempotent — every insert uses upsert/onConflict targeting the natural
// unique key for that table, so re-running this against an already-
// seeded DB is a safe no-op.
//
// Usage:  npx tsx scripts/apply-wc-seed.ts

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ─────────────────────────────────────────────────────────────────────
// 1) DATA — mirrors the seed SQL exactly. Keep in sync if the SQL changes.
// ─────────────────────────────────────────────────────────────────────

const NATIONAL_TEAMS = [
  { name: 'Brazil',       short_name: 'Brazil',  abbreviation: 'BRA',  logo: 'br' },
  { name: 'Morocco',      short_name: 'Morocco', abbreviation: 'MAR',  logo: 'ma' },
  { name: 'France',       short_name: 'France',  abbreviation: 'FRA',  logo: 'fr' },
  { name: 'Senegal',      short_name: 'Senegal', abbreviation: 'SEN',  logo: 'sn' },
  { name: 'Norway',       short_name: 'Norway',  abbreviation: 'NOR',  logo: 'no' },
  { name: 'Ecuador',      short_name: 'Ecuador', abbreviation: 'ECU',  logo: 'ec' },
  { name: 'Germany',      short_name: 'Germany', abbreviation: 'GER',  logo: 'de' },
  { name: 'Panama',       short_name: 'Panama',  abbreviation: 'PAN',  logo: 'pa' },
  { name: 'England',      short_name: 'England', abbreviation: 'ENG',  logo: 'gb-eng' },
  { name: 'USA',          short_name: 'USA',     abbreviation: 'USA',  logo: 'us' },
  { name: 'Paraguay',     short_name: 'Paraguay',abbreviation: 'PAR',  logo: 'py' },
  { name: 'Iran',         short_name: 'Iran',    abbreviation: 'IRN',  logo: 'ir' },
  { name: 'New Zealand',  short_name: 'NZ',      abbreviation: 'NZL',  logo: 'nz' },
  { name: 'Switzerland',  short_name: 'Swiss',   abbreviation: 'SUI',  logo: 'ch' },
  { name: 'Belgium',      short_name: 'Belgium', abbreviation: 'BEL',  logo: 'be' },
];

// 16 matches: 8 MetLife (NY) + 8 SoFi (LA). Marquee team in home_team_*.
const GAMES: Array<{
  source_event_id: string;
  home: string;
  away: string;
  venue: 'MetLife Stadium' | 'SoFi Stadium';
  city: 'New York' | 'Los Angeles';
  start_time_utc: string;
}> = [
  // MetLife (NY) ——————————————————————————————————————
  { source_event_id: 'fifa-wc-m07',  home: 'Brazil',  away: 'Morocco',           venue: 'MetLife Stadium', city: 'New York',    start_time_utc: '2026-06-13 22:00:00+00' },
  { source_event_id: 'fifa-wc-m17',  home: 'France',  away: 'Senegal',           venue: 'MetLife Stadium', city: 'New York',    start_time_utc: '2026-06-16 19:00:00+00' },
  { source_event_id: 'fifa-wc-m41',  home: 'Norway',  away: 'Senegal',           venue: 'MetLife Stadium', city: 'New York',    start_time_utc: '2026-06-23 00:00:00+00' },
  { source_event_id: 'fifa-wc-m56',  home: 'Germany', away: 'Ecuador',           venue: 'MetLife Stadium', city: 'New York',    start_time_utc: '2026-06-25 20:00:00+00' },
  { source_event_id: 'fifa-wc-m67',  home: 'England', away: 'Panama',            venue: 'MetLife Stadium', city: 'New York',    start_time_utc: '2026-06-27 21:00:00+00' },
  { source_event_id: 'fifa-wc-m77',  home: 'TBD',     away: 'TBD',               venue: 'MetLife Stadium', city: 'New York',    start_time_utc: '2026-06-30 21:00:00+00' },
  { source_event_id: 'fifa-wc-m91',  home: 'Winner Match 76', away: 'Winner Match 78',   venue: 'MetLife Stadium', city: 'New York', start_time_utc: '2026-07-05 20:00:00+00' },
  { source_event_id: 'fifa-wc-m104', home: 'Winner Match 101', away: 'Winner Match 102', venue: 'MetLife Stadium', city: 'New York', start_time_utc: '2026-07-19 19:00:00+00' },
  // SoFi (LA) ——————————————————————————————————————
  { source_event_id: 'fifa-wc-m04',  home: 'USA',          away: 'Paraguay',     venue: 'SoFi Stadium', city: 'Los Angeles', start_time_utc: '2026-06-13 01:00:00+00' },
  { source_event_id: 'fifa-wc-m15',  home: 'Iran',         away: 'New Zealand',  venue: 'SoFi Stadium', city: 'Los Angeles', start_time_utc: '2026-06-16 01:00:00+00' },
  { source_event_id: 'fifa-wc-m26',  home: 'Switzerland',  away: 'Euro Play-off Winner A', venue: 'SoFi Stadium', city: 'Los Angeles', start_time_utc: '2026-06-18 19:00:00+00' },
  { source_event_id: 'fifa-wc-m39',  home: 'Belgium',      away: 'Iran',         venue: 'SoFi Stadium', city: 'Los Angeles', start_time_utc: '2026-06-21 19:00:00+00' },
  { source_event_id: 'fifa-wc-m59',  home: 'USA',          away: 'Euro Play-off Winner C', venue: 'SoFi Stadium', city: 'Los Angeles', start_time_utc: '2026-06-26 02:00:00+00' },
  { source_event_id: 'fifa-wc-m73',  home: 'Runner-up Group A', away: 'Runner-up Group B', venue: 'SoFi Stadium', city: 'Los Angeles', start_time_utc: '2026-06-28 19:00:00+00' },
  { source_event_id: 'fifa-wc-m84',  home: 'Winner Group H', away: 'Runner-up Group J',    venue: 'SoFi Stadium', city: 'Los Angeles', start_time_utc: '2026-07-02 19:00:00+00' },
  { source_event_id: 'fifa-wc-m98',  home: 'Winner Match 93', away: 'Winner Match 94',     venue: 'SoFi Stadium', city: 'Los Angeles', start_time_utc: '2026-07-10 19:00:00+00' },
];

// Hand-tuned scores per match — must match the SQL exactly.
const SCORES: Record<string, { price: number; exp: number; quality: number; timing: number; context: number; deal: number; summary: string }> = {
  'fifa-wc-m07':  { price: 3.5, exp: 9.5, quality: 8.5, timing: 9.0, context: 10.0, deal: 7.2, summary: "Brazil at MetLife on a Saturday primetime is a near-perfect group stage matchup. Expensive but unforgettable." },
  'fifa-wc-m17':  { price: 3.5, exp: 9.5, quality: 8.5, timing: 8.0, context: 10.0, deal: 7.1, summary: "France vs Senegal is a heavyweight group stage clash. Tuesday afternoon kickoff at premium prices." },
  'fifa-wc-m41':  { price: 3.5, exp: 9.5, quality: 8.0, timing: 7.5, context: 10.0, deal: 7.0, summary: "Haaland's first World Cup at MetLife — Monday primetime, premium pricing." },
  'fifa-wc-m56':  { price: 3.5, exp: 9.5, quality: 8.0, timing: 8.0, context: 10.0, deal: 7.1, summary: "Germany trying to lock the group — Thursday late afternoon at MetLife." },
  'fifa-wc-m67':  { price: 3.5, exp: 9.5, quality: 8.0, timing: 9.0, context: 10.0, deal: 7.2, summary: "England's final group game at MetLife — Saturday at the highest stakes of group stage." },
  'fifa-wc-m77':  { price: 3.0, exp: 9.8, quality: 8.5, timing: 8.0, context: 10.0, deal: 7.2, summary: "First knockout at MetLife. Tuesday primetime. One team goes home — that's the deal." },
  'fifa-wc-m91':  { price: 2.5, exp: 10.0, quality: 9.0, timing: 9.5, context: 10.0, deal: 7.5, summary: "Round of 16 at MetLife on a Sunday. The field cuts in half. Lock it in if you can." },
  'fifa-wc-m104': { price: 1.5, exp: 10.0, quality: 10.0, timing: 10.0, context: 10.0, deal: 7.5, summary: "The Final. At MetLife. On a Sunday afternoon. There is no bigger ticket on Earth — and the price reflects it." },
  'fifa-wc-m04':  { price: 4.0, exp: 9.5, quality: 8.5, timing: 9.5, context: 10.0, deal: 7.5, summary: "USA opens the tournament at SoFi on a Friday night. Stars and stripes energy. Easy yes." },
  'fifa-wc-m15':  { price: 4.5, exp: 9.0, quality: 6.5, timing: 7.0, context: 10.0, deal: 6.7, summary: "Iran vs NZ at SoFi — mid group matchup, Monday primetime. Solid if you can swing it." },
  'fifa-wc-m26':  { price: 4.0, exp: 9.0, quality: 7.0, timing: 7.5, context: 10.0, deal: 6.8, summary: "Switzerland is a sneaky team, opponent is TBD play-off winner. Daytime SoFi football." },
  'fifa-wc-m39':  { price: 3.5, exp: 9.5, quality: 8.0, timing: 8.5, context: 10.0, deal: 7.2, summary: "Belgium with De Bruyne at SoFi on a Sunday matinee. Premium pricing, premium opponent." },
  'fifa-wc-m59':  { price: 3.5, exp: 9.5, quality: 8.5, timing: 9.0, context: 10.0, deal: 7.3, summary: "USA's last group game at SoFi — Thursday primetime, knockout vibes already." },
  'fifa-wc-m73':  { price: 3.0, exp: 9.8, quality: 8.5, timing: 8.5, context: 10.0, deal: 7.3, summary: "First knockout at SoFi. Sunday matinee. Tournament officially starts here." },
  'fifa-wc-m84':  { price: 3.0, exp: 9.8, quality: 8.5, timing: 8.0, context: 10.0, deal: 7.2, summary: "Second SoFi knockout. Group winners get tested. Thursday daytime." },
  'fifa-wc-m98':  { price: 2.0, exp: 10.0, quality: 9.5, timing: 9.5, context: 10.0, deal: 7.5, summary: "Quarterfinal at SoFi. Final 8. Friday matinee, world watching." },
};

const INSIGHTS: Record<string, {
  verdict: string;
  why_worth_it: string;
  expectation_summary: string;
  target_audience: string[];
  effort_level: string;
  price_insight: string;
  seat_expectation: string;
  context_flags: string[];
  confidence_score: number;
}> = {
  'fifa-wc-m07': {
    verdict: "Brazil at MetLife on a Saturday primetime. Lock it in if you can swing it.",
    why_worth_it: "Selecao's tournament opener in NY — first look at whether this group has Final energy or just samba and vibes. MetLife will be 80,000 strong.",
    expectation_summary: "Sold-out feel, Brazilian crowd dominant, samba drums and yellow shirts everywhere.",
    target_audience: ["hardcore fans","social outing"], effort_level: "high_effort",
    price_insight: "Premium pricing — this is Brazil at MetLife, sticker shock is real.",
    seat_expectation: "Upper bowl unless you're going big.",
    context_flags: ["wc-group"], confidence_score: 0.95,
  },
  'fifa-wc-m17': {
    verdict: "France in the city. Pay up and go.",
    why_worth_it: "Mbappe era France vs a feisty Senegal — group stage rarely gets this loaded. Tuesday daytime kickoff at MetLife means you're home in time for dinner.",
    expectation_summary: "World-class football, mixed crowd with strong French and Senegalese support.",
    target_audience: ["hardcore fans","social outing"], effort_level: "high_effort",
    price_insight: "Premium pricing for a heavyweight group matchup.",
    seat_expectation: "Upper deck for entry pricing.",
    context_flags: ["wc-group"], confidence_score: 0.95,
  },
  'fifa-wc-m41': {
    verdict: "Haaland at MetLife on a Monday primetime. Honestly worth it just for that.",
    why_worth_it: "Norway's first World Cup since '98 plus Senegal trying to keep their dream alive. One of the most electric strikers in the game, in person.",
    expectation_summary: "Norway fans traveling deep, primetime atmosphere.",
    target_audience: ["hardcore fans"], effort_level: "high_effort",
    price_insight: "Premium pricing — Haaland tax is real.",
    seat_expectation: "Upper bowl for entry; midfield lower if you push the budget.",
    context_flags: ["wc-group"], confidence_score: 0.92,
  },
  'fifa-wc-m56': {
    verdict: "Germany at MetLife is the move.",
    why_worth_it: "Die Mannschaft trying to lock up the group — Ecuador won't roll over. Late-afternoon kickoff, beers at the tailgate after.",
    expectation_summary: "Heavy German support, classic WC group atmosphere.",
    target_audience: ["hardcore fans","social outing"], effort_level: "high_effort",
    price_insight: "Premium pricing.", seat_expectation: "Upper bowl for entry.",
    context_flags: ["wc-group"], confidence_score: 0.92,
  },
  'fifa-wc-m67': {
    verdict: "England's last group game in NY. Big crowd, big stakes.",
    why_worth_it: "Three Lions probably need a result to advance — Saturday afternoon at MetLife and the away support will be cooking.",
    expectation_summary: "Big English contingent, classic Saturday afternoon WC vibes.",
    target_audience: ["hardcore fans","social outing"], effort_level: "high_effort",
    price_insight: "Premium pricing, especially for England.",
    seat_expectation: "Upper deck unless you go big.",
    context_flags: ["wc-group"], confidence_score: 0.94,
  },
  'fifa-wc-m77': {
    verdict: "Knockout football at MetLife. The teams aren't decided yet but the stakes are.",
    why_worth_it: "First time MetLife hosts a knockout match. Whoever lands here, one team goes home — that's the whole deal.",
    expectation_summary: "Sold out regardless of who shows up. Knockout intensity.",
    target_audience: ["hardcore fans"], effort_level: "high_effort",
    price_insight: "Knockout premium — the price doesn't care who plays.",
    seat_expectation: "Upper bowl.",
    context_flags: ["wc-round-of-32"], confidence_score: 0.85,
  },
  'fifa-wc-m91': {
    verdict: "Sweet 16 of the world. Lock it in.",
    why_worth_it: "The field cuts in half — whoever survives Round of 32 goes head-to-head on a Sunday at MetLife.",
    expectation_summary: "Massive atmosphere, knockout do-or-die energy.",
    target_audience: ["hardcore fans","social outing"], effort_level: "high_effort",
    price_insight: "R16 pricing — steep but defensible for the stakes.",
    seat_expectation: "Upper deck for entry, midfield for the experience.",
    context_flags: ["wc-round-of-16"], confidence_score: 0.85,
  },
  'fifa-wc-m104': {
    verdict: "It's the Final. Don't overthink it.",
    why_worth_it: "The biggest soccer game of the next four years is in NJ. Whoever's left has earned it. So have you, if you go.",
    expectation_summary: "The Final. There is nothing bigger on the calendar.",
    target_audience: ["hardcore fans"], effort_level: "high_effort",
    price_insight: "Top of the market — you're paying for a memory, not a deal.",
    seat_expectation: "Whatever you can afford. There are no bad seats.",
    context_flags: ["wc-final"], confidence_score: 0.99,
  },
  'fifa-wc-m04': {
    verdict: "USA opener in LA. Easy yes.",
    why_worth_it: "Stars and stripes kick off the tournament at SoFi on a Friday night — opening-game atmosphere is a different beast.",
    expectation_summary: "Sea of red white and blue, opening-match buzz.",
    target_audience: ["hardcore fans","casual fans","social outing"], effort_level: "high_effort",
    price_insight: "Premium pricing for an opener — book early if you're going.",
    seat_expectation: "Upper bowl for entry, lower for the experience.",
    context_flags: ["wc-group"], confidence_score: 0.95,
  },
  'fifa-wc-m15': {
    verdict: "Group stage at SoFi — solid pick if your night's free.",
    why_worth_it: "Iran brings real away support; New Zealand is the underdog you root for. Monday night in Inglewood.",
    expectation_summary: "Smaller crowd than a marquee match but still proper WC atmosphere.",
    target_audience: ["casual fans","social outing"], effort_level: "moderate",
    price_insight: "On the cheaper end of WC pricing — solid value for the tournament.",
    seat_expectation: "Plenty of lower-bowl availability at entry pricing.",
    context_flags: ["wc-group"], confidence_score: 0.85,
  },
  'fifa-wc-m26': {
    verdict: "Daytime World Cup at SoFi. Why not.",
    why_worth_it: "Switzerland is a quiet danger and the play-off winner shows up with everything to prove. Beat the heat, sit in the shade, enjoy.",
    expectation_summary: "Lunch-hour crowd, mellow but engaged.",
    target_audience: ["casual fans","social outing"], effort_level: "moderate",
    price_insight: "Mid-range WC pricing.",
    seat_expectation: "Lower bowl on the shaded side is the move.",
    context_flags: ["wc-group"], confidence_score: 0.82,
  },
  'fifa-wc-m39': {
    verdict: "De Bruyne energy in LA. Sunday matinee.",
    why_worth_it: "Belgium's loaded again, Iran will make them earn it. SoFi crowd, lunch kickoff, classic group stage chaos.",
    expectation_summary: "Heavy Belgian and Iranian crowds — atmosphere will be loud.",
    target_audience: ["hardcore fans","social outing"], effort_level: "high_effort",
    price_insight: "Premium pricing for a Belgium match.",
    seat_expectation: "Upper bowl entry.",
    context_flags: ["wc-group"], confidence_score: 0.92,
  },
  'fifa-wc-m59': {
    verdict: "USA's last group game. Knockout vibes already.",
    why_worth_it: "Win and walk through. Lose and the dream gets complicated. Thursday primetime at SoFi is going to be loud.",
    expectation_summary: "Stars and stripes everywhere, do-or-die energy.",
    target_audience: ["hardcore fans","casual fans","social outing"], effort_level: "high_effort",
    price_insight: "Premium pricing — USA in a must-win.",
    seat_expectation: "Upper deck for entry, lower for the moment.",
    context_flags: ["wc-group"], confidence_score: 0.95,
  },
  'fifa-wc-m73': {
    verdict: "First knockout at SoFi. Don't blink.",
    why_worth_it: "Two surviving group teams — the tournament officially starts here. Sunday matinee, beer, vibes.",
    expectation_summary: "Sold out. Knockout intensity.",
    target_audience: ["hardcore fans"], effort_level: "high_effort",
    price_insight: "Knockout premium.",
    seat_expectation: "Upper bowl.",
    context_flags: ["wc-round-of-32"], confidence_score: 0.85,
  },
  'fifa-wc-m84': {
    verdict: "Second SoFi knockout — high stakes, daytime kickoff.",
    why_worth_it: "Group winners get tested. If your Thursday is open, this is the move.",
    expectation_summary: "Big crowd, knockout intensity.",
    target_audience: ["hardcore fans"], effort_level: "high_effort",
    price_insight: "Knockout premium.",
    seat_expectation: "Upper bowl.",
    context_flags: ["wc-round-of-32"], confidence_score: 0.85,
  },
  'fifa-wc-m98': {
    verdict: "Final 8. This one matters.",
    why_worth_it: "You're four wins from the trophy. Whoever shows up at SoFi has earned a Friday matinee with the world watching.",
    expectation_summary: "Sold out, electric, every play carries weight.",
    target_audience: ["hardcore fans"], effort_level: "high_effort",
    price_insight: "QF pricing — premium and worth it for stakes.",
    seat_expectation: "Upper for entry, midfield lower for the memory.",
    context_flags: ["wc-quarterfinal"], confidence_score: 0.92,
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2) APPLY
// ─────────────────────────────────────────────────────────────────────

async function main() {
  // ── World city ──────────────────────────────────────
  console.log('• Upserting World city...');
  const { error: cityErr } = await sb
    .from('cities')
    .upsert(
      [{ name: 'World', state: '', timezone: 'UTC', is_active: false }],
      { onConflict: 'name,state' }
    );
  if (cityErr) throw new Error(`cities: ${cityErr.message}`);

  // Lookup city ids we need
  const { data: cities } = await sb.from('cities').select('id, name').in('name', ['World', 'New York', 'Los Angeles']);
  const cityId = (name: string) => cities!.find(c => c.name === name)!.id;

  // ── National teams + TBD placeholder ───────────────
  console.log('• Upserting 16 national teams...');
  const worldId = cityId('World');
  const teamRows = [
    ...NATIONAL_TEAMS.map(t => ({
      name: t.name,
      short_name: t.short_name,
      abbreviation: t.abbreviation,
      league: 'FIFA-WC',
      league_level: 'major',
      city_id: worldId,
      venue_name: 'Various',
      venue_type: 'outdoor',
      logo_url: `https://flagcdn.com/w320/${t.logo}.png`,
    })),
    {
      name: 'FIFA WC TBD', short_name: 'TBD', abbreviation: 'TBD',
      league: 'FIFA-WC', league_level: 'major', city_id: worldId,
      venue_name: 'Various', venue_type: 'outdoor', logo_url: null as string | null,
    },
  ];
  // teams table has no UNIQUE constraint on name — skip the upsert and
  // just insert. Skip rows for teams that already exist to keep this
  // re-runnable.
  const { data: existing } = await sb.from('teams').select('name').eq('league', 'FIFA-WC');
  const existingNames = new Set((existing ?? []).map(t => t.name));
  const newTeamRows = teamRows.filter(t => !existingNames.has(t.name));
  if (newTeamRows.length > 0) {
    const { error: teamErr } = await sb.from('teams').insert(newTeamRows);
    if (teamErr) throw new Error(`teams: ${teamErr.message}`);
  }
  console.log(`  (${newTeamRows.length} new, ${teamRows.length - newTeamRows.length} already existed)`);

  const { data: allTeams } = await sb.from('teams').select('id, name').eq('league', 'FIFA-WC');
  const teamId = (name: string) => {
    const t = allTeams!.find(x => x.name === name);
    if (!t) throw new Error(`team not found: ${name}`);
    return t.id;
  };
  const tbdId = teamId('FIFA WC TBD');

  // ── Games ──────────────────────────────────────────
  console.log('• Upserting 16 games...');
  const TBD_NAMES = new Set(['TBD']);
  const PLACEHOLDER_PREFIXES = ['Winner ', 'Runner-up ', 'Euro Play'];

  function resolveTeamId(displayName: string): string {
    if (TBD_NAMES.has(displayName)) return tbdId;
    if (PLACEHOLDER_PREFIXES.some(p => displayName.startsWith(p))) return tbdId;
    return teamId(displayName);
  }

  const gameRows = GAMES.map(g => ({
    home_team_id: resolveTeamId(g.home),
    away_team_id: resolveTeamId(g.away),
    home_team_name: g.home,
    away_team_name: g.away,
    league: 'FIFA-WC',
    venue: g.venue,
    city_id: cityId(g.city),
    start_time: g.start_time_utc,
    status: 'scheduled',
    source: 'manual-wc-2026',
    source_event_id: g.source_event_id,
    is_home_game: true,
    is_featured: true,
    pipeline_status: 'enriched',
  }));
  const { error: gameErr } = await sb
    .from('games')
    .upsert(gameRows, { onConflict: 'source_event_id,source' });
  if (gameErr) throw new Error(`games: ${gameErr.message}`);

  const { data: gamesById } = await sb
    .from('games')
    .select('id, source_event_id')
    .eq('source', 'manual-wc-2026');
  const gameId = (sourceId: string) => gamesById!.find(g => g.source_event_id === sourceId)!.id;

  // ── Scores ─────────────────────────────────────────
  console.log('• Upserting 16 scores...');
  const scoreRows = Object.entries(SCORES).map(([src, s]) => ({
    game_id: gameId(src),
    price_score: s.price,
    experience_score: s.exp,
    game_quality_score: s.quality,
    timing_score: s.timing,
    context_score: s.context,
    deal_score: s.deal,
    reasoning_summary: s.summary,
    score_breakdown: {
      price: { score: s.price, reasoning: 'WC pricing' },
      experience: { score: s.exp, reasoning: 'World Cup' },
      quality: { score: s.quality, reasoning: 'WC matchup' },
    },
  }));
  const { error: scoreErr } = await sb.from('scores').upsert(scoreRows, { onConflict: 'game_id' });
  if (scoreErr) throw new Error(`scores: ${scoreErr.message}`);

  // ── Insights ───────────────────────────────────────
  console.log('• Upserting 16 game_insights...');
  const insightRows = Object.entries(INSIGHTS).map(([src, i]) => ({
    game_id: gameId(src),
    verdict: i.verdict,
    why_worth_it: i.why_worth_it,
    expectation_summary: i.expectation_summary,
    target_audience: i.target_audience,
    effort_level: i.effort_level,
    price_insight: i.price_insight,
    seat_expectation: i.seat_expectation,
    context_flags: i.context_flags,
    confidence_score: i.confidence_score,
  }));
  const { error: insightErr } = await sb.from('game_insights').upsert(insightRows, { onConflict: 'game_id' });
  if (insightErr) throw new Error(`game_insights: ${insightErr.message}`);

  // ── Tags ───────────────────────────────────────────
  console.log('• Upserting tags...');
  const tagRows: { game_id: string; tag_name: string; source_type: string }[] = [];
  for (const g of GAMES) {
    for (const tag of ['high-energy', 'social-outing', 'hardcore-fans']) {
      tagRows.push({ game_id: gameId(g.source_event_id), tag_name: tag, source_type: 'rule' });
    }
  }
  const { error: tagErr } = await sb.from('tags').upsert(tagRows, { onConflict: 'game_id,tag_name' });
  if (tagErr) throw new Error(`tags: ${tagErr.message}`);

  console.log('\n✓ WC seed applied. 16 games at MetLife + SoFi are now live.');
}

main().then(() => process.exit(0)).catch(err => { console.error('✗', err.message); process.exit(1); });
