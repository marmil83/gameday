// /api/share/[gameId] — Branded shareable card image (PNG).
//
// Used by the GameCard "Share" button: the generated PNG is handed to
// the native Web Share sheet on mobile (iMessage / Instagram / group
// chats) and works as the OG image for link unfurls.
//
// Dark Gen-Z aesthetic: near-black bg, score-graded accent color,
// oversized score, verdict as a pull-quote. 1200×630 — link-unfurl
// standard, story-friendly.

import { ImageResponse } from 'next/og';
import { createServiceClient } from '@/lib/supabase/server';

// Supabase service client needs Node APIs, so pin the Node runtime.
export const runtime = 'nodejs';

function scoreLabel(s: number): string {
  if (s >= 8) return 'GREAT DEAL';
  if (s >= 6) return 'GOOD DEAL';
  if (s >= 4) return 'FAIR';
  return 'SKIP IT';
}
// Per-team logo overrides for teams whose default mark is dark-on-
// transparent. Keep in sync with GameCard.tsx.
const LOGO_OVERRIDES: Record<string, string> = {
  'New York Yankees': 'https://a.espncdn.com/i/teamlogos/mlb/500-dark/nyy.png',
};

// Score → accent color (green great → amber fair → red skip)
function scoreColor(s: number): string {
  if (s >= 8) return '#34c759';
  if (s >= 6) return '#9ad636';
  if (s >= 4) return '#ff9f0a';
  return '#ff453a';
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ gameId: string }> },
) {
  const { gameId } = await params;
  const supabase = createServiceClient();

  const { data: game } = await supabase
    .from('games')
    .select(`
      id, home_team_name, away_team_name, start_time, venue, league,
      home_team:teams!home_team_id ( logo_url ),
      scores ( deal_score ),
      game_insights ( verdict ),
      pricing_snapshots ( lowest_price )
    `)
    .eq('id', gameId)
    .single();

  // Brand-only fallback when the game isn't found — never 500 on a share click.
  if (!game) {
    return new ImageResponse(
      (
        <div style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0b0b0f', color: '#fff', fontSize: 64, fontWeight: 700 }}>
          WorthGoing
        </div>
      ),
      { width: 1200, height: 630 },
    );
  }

  type Rel<T> = T | T[] | null;
  const pick = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  const score = Number(pick(game.scores as Rel<{ deal_score: number }>)?.deal_score ?? 0);
  const verdict = pick(game.game_insights as Rel<{ verdict: string }>)?.verdict ?? '';
  const rawHomeLogo = pick(game.home_team as Rel<{ logo_url: string | null }>)?.logo_url ?? null;
  const homeLogo = LOGO_OVERRIDES[game.home_team_name] ?? rawHomeLogo;
  // Cheapest non-null price across snapshots
  const prices = (Array.isArray(game.pricing_snapshots) ? game.pricing_snapshots : [])
    .map((p: { lowest_price: number | null }) => p.lowest_price)
    .filter((p): p is number => p != null);
  const lowestPrice = prices.length ? Math.min(...prices) : null;

  const accent = scoreColor(score);
  const label = scoreLabel(score);
  // Two-line budget at 26px font on this canvas height.
  const verdictText = verdict.length > 120 ? verdict.slice(0, 117) + '…' : verdict;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: '#0b0b0f',
          padding: '52px 72px 44px',
          fontFamily: 'sans-serif',
          position: 'relative',
        }}
      >
        {/* Accent glow bar at top */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, background: accent }} />

        {/* Header: wordmark + league */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 34, fontWeight: 700, color: '#fff', letterSpacing: -1 }}>WorthGoing</div>
            <div style={{ fontSize: 18, color: '#86868b', marginTop: 2 }}>Know Before You Go</div>
          </div>
          <div style={{ fontSize: 20, color: '#86868b', textTransform: 'uppercase', letterSpacing: 2 }}>
            {game.league}
          </div>
        </div>

        {/* Matchup row */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 40, gap: 28 }}>
          {homeLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={homeLogo} width={96} height={96} style={{ objectFit: 'contain' }} alt="" />
          ) : (
            <div style={{ width: 96, height: 96, borderRadius: 48, background: '#1c1c22', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#86868b', fontSize: 40, fontWeight: 700 }}>
              {game.home_team_name.charAt(0)}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 44, fontWeight: 700, color: '#fff', lineHeight: 1.1 }}>
              {game.away_team_name}
            </div>
            <div style={{ fontSize: 28, color: '#a1a1aa', marginTop: 4 }}>
              {`at ${game.home_team_name}`}
            </div>
          </div>
        </div>

        {/* Score + label */}
        <div style={{ display: 'flex', alignItems: 'flex-end', marginTop: 32, gap: 20 }}>
          <div style={{ fontSize: 132, fontWeight: 800, color: accent, lineHeight: 0.9 }}>
            {score.toFixed(1)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 18 }}>
            <div style={{ fontSize: 30, fontWeight: 700, color: accent, letterSpacing: 1 }}>{label}</div>
            <div style={{ fontSize: 22, color: '#86868b' }}>WorthGoing Score</div>
          </div>
        </div>

        {/* Verdict pull-quote */}
        {verdictText ? (
          <div style={{ display: 'flex', fontSize: 26, color: '#e4e4e7', marginTop: 28, lineHeight: 1.3, maxWidth: 1010 }}>
            {`“${verdictText}”`}
          </div>
        ) : null}

        {/* Footer: price + domain */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
          {lowestPrice != null ? (
            <div style={{ display: 'flex', alignItems: 'center', background: accent, color: '#0b0b0f', fontSize: 30, fontWeight: 800, padding: '14px 28px', borderRadius: 100 }}>
              {`Tickets from $${lowestPrice}`}
            </div>
          ) : <div style={{ display: 'flex' }} />}
          <div style={{ fontSize: 26, color: '#86868b', fontWeight: 600 }}>worthgoing.to</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // 5 min edge cache; share images don't need to be live to the second.
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    },
  );
}
