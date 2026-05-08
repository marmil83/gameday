/**
 * Big Game Detector
 *
 * Detects high-stakes game signals so the scoring engine and AI copy
 * can treat them differently from routine regular season games.
 *
 * Signals detected:
 *  - Playoff round (first round → conference finals → finals)
 *  - Series game number (Game 1 through Game 7)
 *  - Elimination games (any game where loser is out)
 *  - Known rivalry matchups
 *  - Opening day / season opener
 *  - Final week of regular season (standings implications)
 *
 * Data source: ESPN public scoreboard API (no key required)
 */

export type PlayoffRound =
  | 'play-in'
  | 'first-round'
  | 'conference-semis'
  | 'conference-finals'
  | 'finals';

export interface BigGameContext {
  /** Actual opponent name resolved from ESPN (populated when DB has TBD) */
  detectedOpponent: string | null;
  /** Is this a playoff game at all? */
  isPlayoffs: boolean;
  /** Which round of the playoffs */
  playoffRound: PlayoffRound | null;
  /** 1–7 — which game in the series */
  seriesGameNumber: number | null;
  /** Human-readable series status, e.g. "Tied 3-3" or "Series 3-2 DET" */
  seriesRecord: string | null;
  /** True for any game where losing = eliminated (Game 5 when down 3-1, Game 7, etc.) */
  isElimination: boolean;
  /** True for the series-clinching game from the favorite's side */
  isChampionshipClincher: boolean;
  /** Is this the Finals / championship round? */
  isFinals: boolean;
  /** Is this a well-known rivalry matchup? */
  isRivalry: boolean;
  rivalryName: string | null;
  /** First game of the regular season (Opening Day / Night) */
  isOpeningDay: boolean;
  /**
   * Human-readable label for UI badges and AI copy.
   * Examples: "Game 7", "Eastern Conference Finals · Game 5", "Rivalry"
   */
  bigGameLabel: string | null;
  /**
   * Score boosts to apply on top of the base scoring engine.
   * These are absolute additions, clamped by the engine to 0–10.
   */
  gameQualityBoost: number;
  contextBoost: number;
}

// ─────────────────────────────────────────────
// Sport routing helpers
// ─────────────────────────────────────────────

const LEAGUE_TO_ESPN: Record<string, { sport: string; league: string }> = {
  NBA: { sport: 'basketball', league: 'nba' },
  WNBA: { sport: 'basketball', league: 'wnba' },
  NHL: { sport: 'hockey', league: 'nhl' },
  MLB: { sport: 'baseball', league: 'mlb' },
  NFL: { sport: 'football', league: 'nfl' },
  MLS: { sport: 'soccer', league: 'usa.1' },
  NWSL: { sport: 'soccer', league: 'usa.nwsl' },
};

// ─────────────────────────────────────────────
// Rivalry map  (home team → set of rivals)
// Both directions are checked automatically.
// ─────────────────────────────────────────────

interface RivalryEntry {
  teams: [string, string]; // partial name matches are fine
  name: string;
}

const RIVALRIES: RivalryEntry[] = [
  // NBA
  { teams: ['Celtics', 'Lakers'], name: 'Celtics–Lakers' },
  { teams: ['Celtics', 'Pistons'], name: 'Celtics–Pistons' },
  { teams: ['Bulls', 'Pistons'], name: 'Bulls–Pistons' },
  { teams: ['Heat', 'Knicks'], name: 'Heat–Knicks' },
  { teams: ['Warriors', 'Cavaliers'], name: 'Warriors–Cavaliers' },
  { teams: ['Pacers', 'Knicks'], name: 'Pacers–Knicks' },
  { teams: ['Trail Blazers', 'Jazz'], name: 'Blazers–Jazz' },
  { teams: ['Spurs', 'Mavericks'], name: 'Spurs–Mavs' },
  { teams: ['Lakers', 'Clippers'], name: 'Battle of LA' },
  // NHL
  { teams: ['Red Wings', 'Blackhawks'], name: 'Red Wings–Blackhawks' },
  { teams: ['Red Wings', 'Avalanche'], name: 'Red Wings–Avalanche' },
  { teams: ['Maple Leafs', 'Canadiens'], name: 'Leafs–Canadiens' },
  { teams: ['Bruins', 'Canadiens'], name: 'Bruins–Canadiens' },
  { teams: ['Rangers', 'Islanders'], name: 'Battle of New York' },
  { teams: ['Penguins', 'Flyers'], name: 'Battle of Pennsylvania' },
  // MLB
  { teams: ['Yankees', 'Red Sox'], name: 'Yankees–Red Sox' },
  { teams: ['Cubs', 'Cardinals'], name: 'Cubs–Cardinals' },
  { teams: ['Giants', 'Dodgers'], name: 'Giants–Dodgers' },
  { teams: ['Tigers', 'White Sox'], name: 'Tigers–White Sox' },
  { teams: ['Tigers', 'Indians'], name: 'Tigers–Guardians' },
  { teams: ['Tigers', 'Guardians'], name: 'Tigers–Guardians' },
  { teams: ['Mets', 'Yankees'], name: 'Subway Series' },
  // NFL
  { teams: ['Lions', 'Packers'], name: 'Lions–Packers' },
  { teams: ['Bears', 'Packers'], name: 'Bears–Packers' },
  { teams: ['Cowboys', 'Eagles'], name: 'Cowboys–Eagles' },
  { teams: ['Steelers', 'Ravens'], name: 'Steelers–Ravens' },
  { teams: ['Patriots', 'Colts'], name: 'Patriots–Colts' },
  // MLS (geographic derbies)
  { teams: ['Fire', 'Crew'], name: 'Ohio–Illinois Derby' },
];

function detectRivalry(homeTeam: string, awayTeam: string): { isRivalry: boolean; rivalryName: string | null } {
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();

  for (const r of RIVALRIES) {
    const [a, b] = r.teams.map(t => t.toLowerCase());
    if ((home.includes(a) && away.includes(b)) || (home.includes(b) && away.includes(a))) {
      return { isRivalry: true, rivalryName: r.name };
    }
  }
  return { isRivalry: false, rivalryName: null };
}

// ─────────────────────────────────────────────
// ESPN Scoreboard lookup
// ─────────────────────────────────────────────

interface ESPNSeriesInfo {
  isPlayoffs: boolean;
  roundName: string | null;       // e.g. "Second Round", "Conference Finals"
  seriesSummary: string | null;   // e.g. "Series tied 3-3"
  gameNumber: number | null;
  eventName: string | null;       // full event title from ESPN
  opponent: string | null;        // actual opponent display name from ESPN
}

async function fetchESPNSeriesInfo(
  homeTeam: string,
  awayTeam: string,
  gameDate: Date,
  espnSport: string,
  espnLeague: string,
): Promise<ESPNSeriesInfo> {
  const dateStr = gameDate.toISOString().slice(0, 10).replace(/-/g, '');
  // Use the correct ESPN site v2 endpoint (not the deprecated v2 path)
  const url = `https://site.api.espn.com/apis/site/v2/sports/${espnSport}/${espnLeague}/scoreboard?dates=${dateStr}&limit=50`;

  let data: any;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { isPlayoffs: false, roundName: null, seriesSummary: null, gameNumber: null, eventName: null, opponent: null };
    data = await res.json();
  } catch {
    return { isPlayoffs: false, roundName: null, seriesSummary: null, gameNumber: null, eventName: null, opponent: null };
  }

  const events: any[] = data.events || [];
  const home = homeTeam.toLowerCase();
  const away = awayTeam.toLowerCase();
  // When the opponent is TBD / unknown, only require the home team to match
  const awayIsTbd = !away || away === 'tbd' || away.startsWith('nba ') ||
    away.startsWith('nhl ') || away.startsWith('mlb ') || away.startsWith('nfl ');

  for (const event of events) {
    const comp = (event.competitions || [])[0];
    if (!comp) continue;

    // Try to match teams by last word (e.g. "Pistons", "Magic")
    const compTeams: string[] = (comp.competitors || []).map((c: any) =>
      (c.team?.displayName || c.team?.shortDisplayName || '').toLowerCase()
    );
    const lastWord = (s: string) => s.split(' ').pop() || s;
    const matchesHome = compTeams.some(t =>
      t.includes(lastWord(home)) || lastWord(home).includes(lastWord(t))
    );
    // Skip away-team check when opponent is TBD — just trust the home team match
    const matchesAway = awayIsTbd || compTeams.some(t =>
      t.includes(lastWord(away)) || lastWord(away).includes(lastWord(t))
    );
    if (!matchesHome || !matchesAway) continue;

    // Resolve the actual opponent name (the competitor that is NOT the home team)
    const opponentCompetitor = (comp.competitors || []).find((c: any) => {
      const name = (c.team?.displayName || '').toLowerCase();
      return !name.includes(lastWord(home));
    });
    const opponent: string | null = opponentCompetitor?.team?.displayName || null;

    // Found the game — extract series/playoff info
    const series = comp.series;
    const noteHeadline = (comp.notes?.[0]?.headline || '').toLowerCase();
    const isPlayoff = series?.type === 'playoff' ||
      (comp.type?.text || '').toLowerCase().includes('playoff') ||
      (comp.type?.abbreviation || '').toLowerCase().includes('post') ||
      noteHeadline.includes('semifinal') || noteHeadline.includes('final') ||
      noteHeadline.includes('round') || noteHeadline.includes('wild card') ||
      !!series;

    const seriesSummary = series?.summary || null;

    // Game number: totalCompetitions tells us which game in the series we're on
    // (ESPN increments this each game — 1 for G1, 7 for G7)
    // For new series ("Series starts X/X"), totalCompetitions may be 0 or absent —
    // fall back to parsing "Game N" from notes/event name.
    let gameNumber: number | null = null;
    if (series?.totalCompetitions && series.totalCompetitions > 0) {
      gameNumber = series.totalCompetitions;
    }
    // Always try to parse from notes/name (catches "East Semifinals - Game 1" etc.)
    const namesToCheck = [comp.notes?.[0]?.headline || '', event.name || '', event.shortName || ''];
    for (const n of namesToCheck) {
      const m = n.match(/game\s*(\d)/i);
      if (m) { gameNumber = parseInt(m[1]); break; }
    }

    // Round name — prefer notes headline (e.g. "East 1st Round - Game 7"),
    // fall back to series title or competition type abbreviation
    const roundName = comp.notes?.[0]?.headline || series?.title || comp.type?.abbreviation || null;

    return {
      isPlayoffs: isPlayoff,
      roundName: isPlayoff ? roundName : null,
      seriesSummary: isPlayoff ? seriesSummary : null,
      gameNumber: isPlayoff ? gameNumber : null,
      eventName: event.name || event.shortName || null,
      opponent,
    };
  }

  return { isPlayoffs: false, roundName: null, seriesSummary: null, gameNumber: null, eventName: null, opponent: null };
}

// ─────────────────────────────────────────────
// Playoff round classifier
// ─────────────────────────────────────────────

function classifyRound(roundName: string | null): PlayoffRound | null {
  if (!roundName) return null;
  const r = roundName.toLowerCase();

  // Check play-in first
  if (r.includes('play-in') || r.includes('play in')) return 'play-in';

  // Semis BEFORE finals — "semifinals" contains "final" so order matters
  if (/\bsemifinals?\b/.test(r) || r.includes('second round') || r.includes('2nd round') ||
      r.includes('conference semi') || r.includes('division series') ||
      r.includes('alds') || r.includes('nlds') || r.includes('rd32')) return 'conference-semis';

  // Conference finals (e.g. "Conference Finals", "East Finals", "ECF")
  if (r.includes('conference final') || r.includes('eastern final') || r.includes('western final') ||
      r.includes('east final') || r.includes('west final') ||
      r.includes('conference championship') || r.includes('alcs') || r.includes('nlcs') ||
      r.includes('ecf') || r.includes('wcf') || r === 'rd4') return 'conference-finals';

  // Championship / the actual finals
  if (r.includes('nba final') || r.includes('stanley cup final') || r.includes('world series') ||
      r.includes('super bowl') || r.includes('mls cup') ||
      (r.includes('final') && !r.includes('semi') && !r.includes('conference') &&
       !r.includes('division') && !r.includes('1st') && !r.includes('2nd') && !r.includes('3rd')) ||
      r === 'rd2' || r === 'champ') return 'finals';

  // First round
  if (r.includes('first round') || r.includes('1st round') || r.includes('wild card') ||
      r.includes('opening round') || r.includes('qualifying') ||
      r === 'rd16') return 'first-round';

  return null;
}

// ─────────────────────────────────────────────
// Elimination game detection
// ─────────────────────────────────────────────

/**
 * Determines if losing this game eliminates a team.
 * - Game 7 is always elimination for both.
 * - Game 5 when one team leads 3-1 is elimination for the trailing team
 *   (the losing team tonight would be 1-4 down or actually get swept).
 * We parse "Series X-Y TM" style summaries.
 */
function isEliminationGame(gameNumber: number | null, seriesSummary: string | null): boolean {
  if (!gameNumber) return false;
  if (gameNumber === 7) return true;

  if (seriesSummary) {
    // Patterns: "Series tied 3-3", "Detroit leads series 3-2", "Boston leads series 3-1"
    const m = seriesSummary.match(/(\d)-(\d)/);
    if (m) {
      const high = Math.max(parseInt(m[1]), parseInt(m[2]));
      const low = Math.min(parseInt(m[1]), parseInt(m[2]));
      // If winner needs 4 wins: any game where high == 3 and low < 3
      // and the trailing team is playing their elimination game
      if (high === 3 && low === 0 && gameNumber === 4) return true;  // potential sweep
      if (high === 3 && low === 1 && gameNumber === 5) return true;  // trailing team
      if (high === 3 && low === 2 && gameNumber === 6) return true;  // trailing team
    }
  }
  return false;
}

// ─────────────────────────────────────────────
// Score boost table
// ─────────────────────────────────────────────

function computeBoosts(ctx: {
  isPlayoffs: boolean;
  playoffRound: PlayoffRound | null;
  isElimination: boolean;
  isFinals: boolean;
  seriesGameNumber: number | null;
  isRivalry: boolean;
  isOpeningDay: boolean;
}): { gameQualityBoost: number; contextBoost: number } {
  let gq = 0;
  let ctx2 = 0;

  if (ctx.isPlayoffs) {
    // Base playoff boost — any playoff game is better than regular season
    gq += 1.5;
    ctx2 += 2.0;

    switch (ctx.playoffRound) {
      case 'finals':
        gq += 3.0; ctx2 += 3.5; break;
      case 'conference-finals':
        gq += 2.5; ctx2 += 3.0; break;
      case 'conference-semis':
        gq += 2.0; ctx2 += 2.0; break;
      case 'first-round':
        gq += 1.0; ctx2 += 1.0; break;
      case 'play-in':
        gq += 1.5; ctx2 += 1.5; break;
    }

    // Game number within series
    if (ctx.seriesGameNumber === 7) { gq += 2.0; ctx2 += 2.5; }
    else if (ctx.seriesGameNumber === 6) { gq += 1.0; ctx2 += 1.5; }
    else if (ctx.seriesGameNumber === 5) { gq += 0.5; ctx2 += 0.5; }

    // Elimination on top
    if (ctx.isElimination) { gq += 1.0; ctx2 += 1.5; }
  }

  if (ctx.isRivalry) { gq += 1.5; }

  // Opening Day — historic first game of the season. Standings are
  // tiny-sample noise on opening week, so we can't lean on quality math;
  // the right signal is the occasion itself.
  if (ctx.isOpeningDay) { gq += 2.0; ctx2 += 1.5; }

  // Cap boosts — game quality max 6, context max 6 (scores clamped to 10 downstream)
  return {
    gameQualityBoost: Math.min(gq, 6),
    contextBoost: Math.min(ctx2, 6),
  };
}

// ─────────────────────────────────────────────
// Big game label builder
// ─────────────────────────────────────────────

function buildLabel(ctx: {
  isPlayoffs: boolean;
  playoffRound: PlayoffRound | null;
  seriesGameNumber: number | null;
  isElimination: boolean;
  isFinals: boolean;
  isRivalry: boolean;
  rivalryName: string | null;
  isOpeningDay: boolean;
  seriesRecord: string | null;
}): string | null {
  const parts: string[] = [];

  if (ctx.isPlayoffs) {
    if (ctx.isFinals) parts.push('Championship Series');
    else if (ctx.playoffRound === 'conference-finals') parts.push('Conference Finals');
    else if (ctx.playoffRound === 'conference-semis') parts.push('Conference Semifinals');
    else if (ctx.playoffRound === 'first-round') parts.push('Playoffs');
    else if (ctx.playoffRound === 'play-in') parts.push('Play-In Game');
    else parts.push('Playoffs');

    if (ctx.seriesGameNumber) parts.push(`· Game ${ctx.seriesGameNumber}`);
    if (ctx.isElimination) parts.push('· Elimination Game');
    if (ctx.seriesRecord) parts.push(`· ${ctx.seriesRecord}`);
  }

  if (ctx.isRivalry && ctx.rivalryName && !ctx.isPlayoffs) {
    parts.push(ctx.rivalryName);
  } else if (ctx.isRivalry && ctx.rivalryName) {
    parts.push(`(Rivalry: ${ctx.rivalryName})`);
  }

  if (ctx.isOpeningDay && parts.length === 0) parts.push('Opening Day');

  return parts.length > 0 ? parts.join(' ') : null;
}

// ─────────────────────────────────────────────
// Opening Day / Night detection
// ─────────────────────────────────────────────

/** MLB Opening Day is typically late March; NBA/NHL season openers in Oct. */
function detectOpeningDay(league: string, gameDate: Date): boolean {
  const month = gameDate.getMonth() + 1; // 1-based
  const day = gameDate.getDate();
  switch (league) {
    case 'MLB': return month === 3 && day >= 25 || month === 4 && day <= 5;
    case 'NBA': return month === 10 && day <= 28;
    case 'NHL': return month === 10 && day <= 20;
    case 'NFL': return month === 9 && day <= 15;
    case 'MLS': return month === 2 || (month === 3 && day <= 10);
    case 'WNBA': return month === 5 && day <= 20;        // typical opens mid-May
    case 'NWSL': return month === 3 && day >= 10 || month === 4 && day <= 5;
    default: return false;
  }
}

// ─────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────

export async function detectBigGame(
  homeTeamName: string,
  awayTeamName: string,
  league: string,
  startTime: string | Date,
): Promise<BigGameContext> {
  const gameDate = typeof startTime === 'string' ? new Date(startTime) : startTime;

  // 1. Rivalry check (synchronous)
  const { isRivalry, rivalryName } = detectRivalry(homeTeamName, awayTeamName);

  // 2. Opening day check
  const isOpeningDay = detectOpeningDay(league, gameDate);

  // 3. ESPN series lookup (async, best-effort)
  const espnRoute = LEAGUE_TO_ESPN[league];
  let espnInfo: ESPNSeriesInfo = {
    isPlayoffs: false, roundName: null, seriesSummary: null, gameNumber: null, eventName: null, opponent: null,
  };
  if (espnRoute) {
    espnInfo = await fetchESPNSeriesInfo(
      homeTeamName, awayTeamName, gameDate, espnRoute.sport, espnRoute.league,
    );
  }

  // 4. Classify round
  const playoffRound = classifyRound(espnInfo.roundName);
  const isFinals = playoffRound === 'finals';

  // 5. Elimination detection
  const isElimination = isEliminationGame(espnInfo.gameNumber, espnInfo.seriesSummary);

  // 6. Boosts
  const { gameQualityBoost, contextBoost } = computeBoosts({
    isPlayoffs: espnInfo.isPlayoffs,
    playoffRound,
    isElimination,
    isFinals,
    seriesGameNumber: espnInfo.gameNumber,
    isRivalry,
    isOpeningDay,
  });

  // 7. Label
  const bigGameLabel = buildLabel({
    isPlayoffs: espnInfo.isPlayoffs,
    playoffRound,
    seriesGameNumber: espnInfo.gameNumber,
    isElimination,
    isFinals,
    isRivalry,
    rivalryName,
    isOpeningDay,
    seriesRecord: espnInfo.seriesSummary,
  });

  return {
    detectedOpponent: espnInfo.opponent,
    isPlayoffs: espnInfo.isPlayoffs,
    playoffRound,
    seriesGameNumber: espnInfo.gameNumber,
    seriesRecord: espnInfo.seriesSummary,
    isElimination,
    isChampionshipClincher: false, // future enhancement
    isFinals,
    isRivalry,
    rivalryName,
    isOpeningDay,
    bigGameLabel,
    gameQualityBoost,
    contextBoost,
  };
}
