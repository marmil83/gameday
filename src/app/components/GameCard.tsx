'use client';

import { useState, useEffect } from 'react';
import type { GameCard as GameCardType, PricingSnapshot } from '@/types/database';
import { PRICING_LABELS } from '@/lib/constants';
import { getVenueLogistics } from '@/lib/venues';
import AlertModal from './AlertModal';

// Display registry for ticket sources we actively pull live prices from.
// Sources without live data + an affiliate program don't appear in the
// comparison panel — mixing them with real prices destroys trust.
// Add a new source here once its affiliate API/scraper is wired up.
const SOURCE_DISPLAY: Record<string, { label: string; favicon: string; isAllin?: boolean; feeNote: string }> = {
  tickpick: {
    label: 'TickPick',
    favicon: 'https://www.tickpick.com/favicon.ico',
    isAllin: true,
    feeNote: "Price is what you pay — no fees added at checkout",
  },
  seatgeek: {
    label: 'SeatGeek',
    favicon: 'https://seatgeek.com/favicon.ico',
    feeNote: "Base price — fees added at checkout",
  },
};

// Partner deep-links. Without affiliate API access we can't go straight
// to a per-game checkout page, so we land users on each platform's
// TEAM PAGE — they see the team's full schedule and pick the game.
// Tried matchup+date search queries first; their search engines are
// tuned for "Taylor Swift Atlanta" and returned 0 results on Vivid /
// Gametime / Ticketmaster with sports-style queries. Team pages are
// reliably non-empty and that's the closest we get without paying.
//
// Per-platform URL patterns (verified via HTTP probe):
//   • StubHub      → /<team-slug>-tickets/                  ✓ team schedule
//   • Vivid Seats  → /<league>/<team-slug>-tickets          ✓ team schedule
//   • Gametime     → no team page works at any pattern we
//                    tested → fall back to search?query=    (best we can do)
//   • SeatGeek     → per-game URL from affiliate_url when
//                    we have one, else /<team-slug>-tickets
//   • Ticketmaster → /discover/concerts?keyword=<team>      ✓ search results
interface PartnerLink {
  name: string;
  favicon: string;
  getUrl: (ctx: {
    home: string;
    away: string;
    league: string;
    venue: string;
    gameDate: Date;
    abbreviation: string | null;
    externalIds: Record<string, unknown> | null;
  }) => string;
}

// Map WC venues to each partner's market-slug convention. MetLife sits in
// New Jersey but the host-city marketing label is "NY/NJ" — SeatGeek and
// Vivid both surface the local inventory under "new york" / "nyc".
function wcCitySlug(venue: string): 'nyc' | 'la' {
  return venue?.toLowerCase().includes('sofi') ? 'la' : 'nyc';
}
function wcCityLabel(slug: 'nyc' | 'la'): string {
  return slug === 'la' ? 'los angeles' : 'new york';
}

// Lowercase-hyphen team slug shared by most marketplaces.
function teamSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// For league === 'FIFA-WC', the regular team-page URL patterns don't
// apply — national teams aren't on platforms as performers. Each partner
// gets routed to its real World Cup landing/grouping/performer page (all
// verified by hand against the venue inventory). Where a partner has
// city-specific WC pages (SeatGeek's /nyc · /la, Vivid's site search)
// we pass the host city slug so visitors land on inventory for the right
// market instead of the whole tournament.
const WC_PARTNER_URL: Record<string, (cityKey: 'nyc' | 'la') => string> = {
  // StubHub's "world-cup-tickets/grouping/45410" is their entire WC catalog
  // sorted by date. No per-city variant we found.
  StubHub:       () => 'https://www.stubhub.com/world-cup-tickets/grouping/45410',
  // Vivid has no dedicated WC page — site search with city qualifier
  // returns the right inventory in real browsers.
  'Vivid Seats': (cityKey) =>
    `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(`world cup ${wcCityLabel(cityKey)}`)}`,
  // Gametime exposes World Cup as a performer ("soccerworldcup") under
  // their 2026-fifa-world-cup-tickets root.
  Gametime:     () => 'https://gametime.co/2026-fifa-world-cup-tickets/performers/soccerworldcup',
  // SeatGeek has city-specific WC pages — /nyc for MetLife, /la for SoFi.
  // HEAD requests 403 (bot-blocked) but the path renders in browsers.
  SeatGeek:     (cityKey) => `https://seatgeek.com/fifa-world-cup-tickets/${cityKey}`,
  // Ticketmaster has FIFA as a performer with artist_id 4067734.
  Ticketmaster: () => 'https://www.ticketmaster.com/2026-world-cup-tickets/artist/4067734',
  // TickPick's all-WC soccer page.
  TickPick:     () => 'https://www.tickpick.com/soccer/world-cup-soccer-tickets/',
};

const PARTNER_LINKS: PartnerLink[] = [
  {
    name: 'StubHub',
    favicon: 'https://www.stubhub.com/favicon.ico',
    // Team page reliably shows the team's full upcoming schedule.
    getUrl: ({ home, league, venue }) => league === 'FIFA-WC'
      ? WC_PARTNER_URL.StubHub(wcCitySlug(venue))
      : `https://www.stubhub.com/${teamSlug(home)}-tickets/`,
  },
  {
    name: 'Vivid Seats',
    favicon: 'https://www.vividseats.com/favicon.ico',
    // Reverting to their site search — the league/<team> path returns a
    // soft-404 ("we can't find that page") for most teams despite a 200
    // HTTP status. Search at least surfaces the team's upcoming events.
    getUrl: ({ home, league, venue }) => league === 'FIFA-WC'
      ? WC_PARTNER_URL['Vivid Seats'](wcCitySlug(venue))
      : `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(home)}`,
  },
  {
    name: 'Gametime',
    favicon: 'https://gametime.co/favicon.ico',
    // Gametime's team page is /<team-slug>-tickets/performers/<league><abbrev>
    // (e.g. mlbdet for Detroit Tigers). Deterministic from our team
    // abbreviation column. Falls back to search if abbreviation is null.
    getUrl: ({ home, league, venue, abbreviation }) => {
      if (league === 'FIFA-WC') return WC_PARTNER_URL.Gametime(wcCitySlug(venue));
      if (abbreviation) {
        const perf = `${league}${abbreviation}`.toLowerCase();
        return `https://gametime.co/${teamSlug(home)}-tickets/performers/${perf}`;
      }
      return `https://gametime.co/search?query=${encodeURIComponent(home)}`;
    },
  },
  {
    name: 'SeatGeek',
    favicon: 'https://seatgeek.com/favicon.ico',
    // Compare-row builder overrides this with the per-game event URL
    // (game.affiliate_url from SeatGeek's API) whenever we have one;
    // this is only the fallback for events SG's API doesn't know about.
    getUrl: ({ home, league, venue }) => league === 'FIFA-WC'
      ? WC_PARTNER_URL.SeatGeek(wcCitySlug(venue))
      : `https://seatgeek.com/${teamSlug(home)}-tickets`,
  },
  {
    name: 'Ticketmaster',
    favicon: 'https://www.ticketmaster.com/favicon.ico',
    // Real team page is /<team-slug>-tickets/artist/<artist_id>. The
    // artist_id is opaque per team — we discover + cache it in
    // teams.external_ids.ticketmaster_artist_id via the one-off backfill
    // script (scripts/backfill-ticketmaster-ids.ts). Falls back to
    // /discover/sports search when we don't have the ID cached yet.
    getUrl: ({ home, league, venue, externalIds }) => {
      if (league === 'FIFA-WC') return WC_PARTNER_URL.Ticketmaster(wcCitySlug(venue));
      const artistId = externalIds?.ticketmaster_artist_id;
      if (artistId) {
        return `https://www.ticketmaster.com/${teamSlug(home)}-tickets/artist/${artistId}`;
      }
      return `https://www.ticketmaster.com/discover/sports?keyword=${encodeURIComponent(home)}`;
    },
  },
  {
    // TickPick is an "all-in" pricing site — what you see is what you pay,
    // no fees added at checkout. Shown as a partner link for every game
    // where we don't have a live TickPick price. For WC, points at their
    // dedicated 2026 World Cup page; for normal teams, the team page.
    name: 'TickPick',
    favicon: 'https://www.tickpick.com/favicon.ico',
    getUrl: ({ home, league, venue }) => league === 'FIFA-WC'
      ? WC_PARTNER_URL.TickPick(wcCitySlug(venue))
      : `https://www.tickpick.com/${teamSlug(home)}-tickets/`,
  },
];

/** Relative time + freshness color from a captured_at ISO timestamp. */
function freshness(capturedAt: string | null | undefined): { label: string; color: string } {
  if (!capturedAt) return { label: 'unknown', color: '#6b6b78' };
  const ageMs = Date.now() - new Date(capturedAt).getTime();
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 60) return { label: `${Math.max(1, mins)}m ago`, color: '#34c759' };
  const hours = Math.floor(mins / 60);
  if (hours < 12) return { label: `${hours}h ago`, color: hours <= 4 ? '#34c759' : '#86868b' };
  const days = Math.floor(hours / 24);
  if (days < 1) return { label: `${hours}h ago`, color: '#ffb347' };
  return { label: `${days}d ago`, color: '#ffb347' };
}

// Two-row layout (works at any width):
//   [icon] TickPick                       from $29 →
//          ALL-IN · CHEAPEST                 12m ago
// Avoids the mobile bug where ALL-IN/CHEAPEST competed with the price
// for horizontal space and wrapped into a misshapen pill.
// Single row in the unified Kayak/Skyscanner-style comparison panel.
// Same visual treatment regardless of whether we have a live price —
// the only difference is the right-side content: priced sources show
// "from $X" + freshness, unpriced sources show "Check price →". This
// keeps every source feeling first-class (real comparison aesthetic)
// instead of segregating "real" sources from "also check" pills.
function TicketSourceRow({
  favicon,
  name,
  price,
  url,
  isAllin,
  capturedAt,
  isCheapest,
}: {
  favicon: string;
  name: string;
  price: number | null; // null = no live price; show "Check price →"
  url: string;
  isAllin?: boolean;
  capturedAt: string | null;
  isCheapest: boolean;
}) {
  const fresh = price != null ? freshness(capturedAt) : null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-3 py-3 px-1 rounded-xl transition-colors group"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <SourceFavicon src={favicon} name={name} className="mt-0.5" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium" style={{ color: '#fafafa' }}>{name}</span>
        {(isAllin || isCheapest) && (
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {isAllin && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(52,199,89,0.14)', color: '#34c759', whiteSpace: 'nowrap' }}
                title="Price shown is what you pay — no fees added"
              >
                ALL-IN
              </span>
            )}
            {isCheapest && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: '#34c759', whiteSpace: 'nowrap' }}
              >
                cheapest
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end shrink-0 gap-0.5">
        <div className="flex items-center gap-1">
          {price != null ? (
            <span className="text-sm font-semibold" style={{ color: '#fafafa', whiteSpace: 'nowrap' }}>from ${price}</span>
          ) : (
            <span className="text-sm" style={{ color: '#9090a0', whiteSpace: 'nowrap' }}>Check price</span>
          )}
          <svg className="w-3.5 h-3.5 ml-0.5" style={{ color: '#6b6b78' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </div>
        {fresh ? (
          <span className="text-[10px]" style={{ color: fresh.color, whiteSpace: 'nowrap' }}>{fresh.label}</span>
        ) : null}
      </div>
    </a>
  );
}

// Favicon with a graceful letter-chip fallback when the icon URL 404s
// (Vivid Seats and a few others have flaky favicon URLs). Prevents the
// pill from rendering with a hole in it.
function SourceFavicon({ src, name, className = '' }: { src: string; name: string; className?: string }) {
  const [errored, setErrored] = useState(false);
  if (errored || !src) {
    return (
      <div
        className={`w-5 h-5 rounded shrink-0 flex items-center justify-center text-[10px] font-bold ${className}`}
        style={{ background: '#fafafa', color: '#0a0a0d' }}
        aria-hidden="true"
      >
        {name.charAt(0)}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      className={`w-5 h-5 rounded object-contain shrink-0 ${className}`}
      onError={() => setErrored(true)}
    />
  );
}

function formatTime(isoString: string, timezone?: string): string {
  const date = new Date(isoString);
  const localHour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || undefined,
      hour: 'numeric',
      hour12: false,
    }).format(date)
  );
  if (localHour >= 0 && localHour < 5) return 'TBD';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

function formatDate(isoString: string, timezone?: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  });
}

function getDealScoreLabel(score: number): string {
  if (score >= 8) return 'Lock it in';
  if (score >= 6) return 'Solid pick';
  if (score >= 4) return 'Fair';
  return 'Pass';
}

// Score → accent color. Mirrors the palette used in the share image so the
// in-app score circle and the shareable PNG agree visually. Green for great
// deals, lime for good, amber for fair, red for skip.
function scoreColor(score: number): string {
  if (score >= 8) return '#34c759';
  if (score >= 6) return '#9ad636';
  if (score >= 4) return '#ff9f0a';
  return '#ff453a';
}

// Per-team logo overrides for teams whose default mark is dark-on-
// transparent and vanishes on the dark card. We use ESPN's `500-dark`
// variant (a true white-on-transparent version) instead of trying to
// fake it with a halo or chip. Keep in sync with the matching map in
// /api/share/[gameId].
const LOGO_OVERRIDES: Record<string, string> = {
  'New York Yankees': 'https://a.espncdn.com/i/teamlogos/mlb/500-dark/nyy.png',
};

// Official team site for each team we currently host. The card's home-team
// logo links here when an entry exists; teams without a mapping render the
// logo unlinked. Adding a new team to the DB → add an entry here.
//
// WC national teams all point at the canonical 2026 tournament site —
// the matchup context is the WC, not "Brazil anywhere in the world", and
// FIFA's per-association pages are sparser than the tournament hub.
const WC_OFFICIAL = 'https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026';
const TEAM_HOMEPAGE: Record<string, string> = {
  // Detroit
  'Detroit Tigers':         'https://www.mlb.com/tigers',
  'Detroit Lions':          'https://www.detroitlions.com',
  'Detroit Pistons':        'https://www.nba.com/pistons',
  'Detroit Red Wings':      'https://www.nhl.com/redwings',
  'Toledo Mud Hens':        'https://www.milb.com/toledo',
  'Erie SeaWolves':         'https://www.milb.com/erie',
  'Grand Rapids Griffins':  'https://www.griffinshockey.com',
  'Detroit City FC':        'https://www.detcityfc.com',

  // Portland
  'Portland Trail Blazers': 'https://www.nba.com/blazers',
  'Portland Timbers':       'https://www.timbers.com',
  'Portland Thorns FC':     'https://www.thorns.com',
  'Portland Fire':          'https://fire.wnba.com',
  'Hillsboro Hops':         'https://www.milb.com/hillsboro',
  'Portland Winterhawks':   'https://winterhawks.com',

  // New York
  'New York Yankees':       'https://www.mlb.com/yankees',
  'New York Mets':          'https://www.mlb.com/mets',
  'New York Knicks':        'https://www.nba.com/knicks',
  'Brooklyn Nets':          'https://www.nba.com/nets',
  'New York Rangers':       'https://www.nhl.com/rangers',
  'New York Islanders':     'https://www.nhl.com/islanders',
  'New York Giants':        'https://www.giants.com',
  'New York Jets':          'https://www.newyorkjets.com',
  'New York City FC':       'https://www.nycfc.com',
  'New York Red Bulls':     'https://www.newyorkredbulls.com',
  'New York Liberty':       'https://liberty.wnba.com',
  'Gotham FC':              'https://gothamfc.com',
  'NJ/NY Gotham FC':        'https://gothamfc.com',

  // Los Angeles
  'Los Angeles Dodgers':    'https://www.mlb.com/dodgers',
  'Los Angeles Angels':     'https://www.mlb.com/angels',
  'Los Angeles Lakers':     'https://www.nba.com/lakers',
  'Los Angeles Clippers':   'https://www.nba.com/clippers',
  'Los Angeles Kings':      'https://www.nhl.com/kings',
  'Anaheim Ducks':          'https://www.nhl.com/ducks',
  'Los Angeles Rams':       'https://www.therams.com',
  'Los Angeles Chargers':   'https://www.chargers.com',
  'LA Galaxy':              'https://www.lagalaxy.com',
  'LAFC':                   'https://www.lafc.com',
  'Los Angeles Sparks':     'https://sparks.wnba.com',
  'Angel City FC':          'https://angelcity.com',

  // Chicago
  'Chicago Cubs':           'https://www.mlb.com/cubs',
  'Chicago White Sox':      'https://www.mlb.com/whitesox',
  'Chicago Bulls':          'https://www.nba.com/bulls',
  'Chicago Blackhawks':     'https://www.nhl.com/blackhawks',
  'Chicago Bears':          'https://www.chicagobears.com',
  'Chicago Fire FC':        'https://www.chicagofirefc.com',
  'Chicago Sky':            'https://sky.wnba.com',
  'Chicago Red Stars':      'https://chicagoredstars.com',

  // FIFA World Cup national teams — all → tournament hub
  Brazil: WC_OFFICIAL, Morocco: WC_OFFICIAL, France: WC_OFFICIAL,
  Senegal: WC_OFFICIAL, Norway: WC_OFFICIAL, Ecuador: WC_OFFICIAL,
  Germany: WC_OFFICIAL, Panama: WC_OFFICIAL, England: WC_OFFICIAL,
  USA: WC_OFFICIAL, Paraguay: WC_OFFICIAL, Iran: WC_OFFICIAL,
  'New Zealand': WC_OFFICIAL, Switzerland: WC_OFFICIAL, Belgium: WC_OFFICIAL,
};

function getPricingLabel(pricing: GameCardType['pricing']): string {
  if (!pricing?.displayed_price) return '';
  return PRICING_LABELS[pricing.pricing_transparency] || 'before fees';
}

function ScoreBar({ label, score, weight }: { label: string; score: number; weight: number }) {
  const pct = (score / 10) * 100;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-20 shrink-0" style={{ color: '#9090a0' }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1f1f28' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: '#fafafa' }}
        />
      </div>
      <span className="w-8 text-right font-medium" style={{ color: '#fafafa' }}>{score.toFixed(1)}</span>
      <span className="w-8 text-right" style={{ color: '#6b6b78' }}>{Math.round(weight * 100)}%</span>
    </div>
  );
}

// ─── Promo display helpers ─────────────────────────────────────────────────

type PromoLike = { promo_type?: string | null; promo_item?: string | null; promo_description?: string | null };

function PromoIcon({ type }: { type?: string | null }) {
  // 16x16 monochrome stroke icons — color set by parent
  const common = { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 };
  switch (type) {
    case 'giveaway':
      return (
        <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V6a2 2 0 10-2 2h2zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>
      );
    case 'fireworks':
      return (
        <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6l2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6l2.1-2.1"/></svg>
      );
    case 'theme_night':
      return (
        <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
      );
    case 'family_promo':
      return (
        <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6 5.87v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2m9-9a4 4 0 100-8 4 4 0 000 8zm6 0a3 3 0 100-6 3 3 0 000 6z"/></svg>
      );
    case 'food_bev_promo':
      return (
        <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M5 3l1 14a2 2 0 002 2h8a2 2 0 002-2l1-14M5 3h14M5 3l-1-1m15 1l1-1M9 7v8m6-8v8"/></svg>
      );
    case 'special_ticket':
      return (
        <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M15 5v2m0 4v2m0 4v2M5 5h14a2 2 0 012 2v3a2 2 0 100 4v3a2 2 0 01-2 2H5a2 2 0 01-2-2v-3a2 2 0 100-4V7a2 2 0 012-2z"/></svg>
      );
    case 'value_game':
      return (
        // Price tag — used for branded value/discount nights like "313 Value Game"
        <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"/></svg>
      );
    default:
      return (
        <svg {...common}><path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
      );
  }
}

function titleCase(s: string) {
  return s.replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1).toLowerCase());
}

function getPromoTitle(promo: PromoLike): string {
  const item = promo.promo_item?.trim();
  switch (promo.promo_type) {
    case 'giveaway':
      return item ? `${titleCase(item)} Giveaway` : 'Fan Giveaway';
    case 'fireworks':
      return 'Post-Game Fireworks';
    case 'theme_night':
      return item ? `${titleCase(item)} Night` : 'Theme Night';
    case 'family_promo':
      return item ? titleCase(item) : 'Family Day';
    case 'food_bev_promo':
      return item ? titleCase(item) : 'Food & Drink Deal';
    case 'special_ticket':
      return item ? titleCase(item) : 'Special Ticket Package';
    case 'value_game':
      // Preserve branded names like "313 Value Game" verbatim — they're
      // the actual marketing label and titleCase would mangle them.
      return item ? item : 'Value Game';
    default:
      return item ? titleCase(item) : 'Promotion';
  }
}

function getPromoDetail(promo: PromoLike, promoClarity?: string | null): string | null {
  // Prefer the AI-written practical sentence (arrival timing, eligibility, etc.)
  if (promoClarity && promoClarity.trim()) return promoClarity.trim();
  const desc = promo.promo_description?.trim();
  // Skip the description if it just restates the title
  if (desc && getPromoTitle(promo).toLowerCase() !== desc.toLowerCase()) return desc;
  return null;
}

// Drop low-signal promo rows and collapse exact duplicates so the UI
// shows real things going on, not noise. AHL/MiLB promo schedules often
// duplicate "family promo day" / "food & bev deal" entries with no
// item — keep the most specific row, drop the bare ones.
function dedupePromos(promos: PromoLike[]): PromoLike[] {
  // Stable rank — most distinctive types first
  const TYPE_RANK: Record<string, number> = {
    giveaway: 0, fireworks: 1, theme_night: 2, special_ticket: 3,
    family_promo: 4, food_bev_promo: 5, value_game: 6,
  };
  const seen = new Set<string>();
  const out: PromoLike[] = [];
  // Sort first so the kept row is the highest-signal one when we collapse
  const sorted = [...promos].sort((a, b) => {
    const ra = TYPE_RANK[a.promo_type ?? ''] ?? 99;
    const rb = TYPE_RANK[b.promo_type ?? ''] ?? 99;
    if (ra !== rb) return ra - rb;
    // Within type: prefer rows with an explicit item
    return (b.promo_item ? 1 : 0) - (a.promo_item ? 1 : 0);
  });
  for (const p of sorted) {
    const item = (p.promo_item ?? '').trim().toLowerCase();
    const desc = (p.promo_description ?? '').trim().toLowerCase();
    // Drop bare type-only rows (no item, no description) — pure noise
    if (!item && !desc) continue;
    // Dedupe key: type + item, OR type + first-30-chars-of-description when item is empty
    const key = item
      ? `${p.promo_type}|${item}`
      : `${p.promo_type}|~${desc.slice(0, 30)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// ─── Price comparison helpers ──────────────────────────────────────────────

function getSavings(score: GameCardType['score'], lowestPrice: number | null): { pct: number; avg: number } | null {
  if (!lowestPrice || !score?.score_breakdown) return null;
  const breakdown = score.score_breakdown as { price?: { reasoning?: string } };
  const reasoning = breakdown.price?.reasoning ?? '';
  // Reasoning can read "Great value at $22 (typical: $55)" or legacy "$22 vs avg $55".
  // Extract every $-prefixed number — the avg is the LAST one in the string.
  const matches = [...reasoning.matchAll(/\$(\d+(?:\.\d+)?)/g)];
  if (matches.length < 2) return null;
  const avg = parseFloat(matches[matches.length - 1][1]);
  if (!avg || lowestPrice >= avg) return null;
  return { pct: Math.round((1 - lowestPrice / avg) * 100), avg };
}

function getCalloutBanner(
  score: GameCardType['score'],
  tags: GameCardType['tags'],
  insights: GameCardType['insights'],
): { text: string; accent: string } | null {
  const priceScore = Number(score?.price_score) || 0;
  const contextFlags = (insights?.context_flags as string[]) || [];
  const tagNames = tags?.map(t => t.tag_name) || [];

  // Priority order: severity > distinctiveness > value/info. Only one
  // banner shows at a time, so put the most "you should pay attention"
  // contexts first. Bad weather lives at the bottom — it's the only
  // negative signal so it never trumps a positive one (e.g. a Game 7
  // in the rain still reads as "Game 7").
  // World Cup stages take priority — the league code already implies WC,
  // but the callout adds the round-specific weight (Final > QF > R16 > R32
  // > Group). Colors match the existing severity gradient so visitors
  // already pattern-match red = "must-see, do-or-die".
  if (contextFlags.includes('wc-final'))          return { text: 'World Cup Final', accent: '#ff3b30' };
  if (contextFlags.includes('wc-semifinal'))      return { text: 'Semifinal', accent: '#ff3b30' };
  if (contextFlags.includes('wc-quarterfinal'))   return { text: 'Quarterfinal', accent: '#ff453a' };
  if (contextFlags.includes('wc-round-of-16'))    return { text: 'Round of 16', accent: '#ff9500' };
  if (contextFlags.includes('wc-round-of-32'))    return { text: 'Round of 32', accent: '#ff9500' };
  if (contextFlags.includes('wc-group'))          return { text: 'Group Stage', accent: '#af52de' };
  if (contextFlags.includes('game-7'))            return { text: 'Game 7', accent: '#ff3b30' };
  if (contextFlags.includes('elimination'))       return { text: 'Elimination Game', accent: '#ff3b30' };
  if (contextFlags.includes('series-finale'))     return { text: 'Series Finale', accent: '#ff3b30' };
  if (contextFlags.includes('finals'))            return { text: 'Finals', accent: '#ff3b30' };
  if (contextFlags.includes('conference-finals')) return { text: 'Conference Finals', accent: '#ff9500' };
  if (contextFlags.includes('playoff'))           return { text: 'Playoff Game', accent: '#ff9500' };
  if (contextFlags.includes('rivalry'))           return { text: 'Rivalry Game', accent: '#af52de' };
  if (contextFlags.includes('doubleheader'))      return { text: 'Doubleheader', accent: '#5856d6' };
  if (contextFlags.includes('opening-day'))       return { text: 'Opening Day', accent: '#0071e3' };
  if (priceScore >= 9 || tagNames.includes('cheap-night')) return { text: 'Value Game', accent: '#34c759' };
  if (contextFlags.includes('bad-weather'))       return { text: 'Weather Concern', accent: '#ffb347' };
  return null;
}

export default function GameCard({ data, timezone }: { data: GameCardType; timezone?: string }) {
  const { game, pricing, all_pricing = [], promotions, score, tags, insights, home_team_logo, away_team_logo } = data;
  const dealScore = Number(score?.deal_score) || 0;
  // Pick the single most distinctive promo as the headline (e.g. giveaway
  // beats food deal). Dropping the multi-promo list per design choice —
  // visitors get the marquee item + practical detail, nothing else.
  const dedupedPromos = dedupePromos(promotions || []);
  const lowestPrice = pricing ? Number(pricing.lowest_price || pricing.displayed_price) : null;
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showTickets, setShowTickets] = useState(false);
  const [shareState, setShareState] = useState<'idle' | 'working' | 'copied'>('idle');
  const [showAlertModal, setShowAlertModal] = useState(false);
  // localStorage-backed "you've signed up for this game" flag so the bell
  // can render filled across sessions without a server round-trip.
  const [isWatching, setIsWatching] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('wg_alerts');
      const map: Record<string, boolean> = raw ? JSON.parse(raw) : {};
      if (map[game.id]) setIsWatching(true);
    } catch {/* private mode etc. */}
  }, [game.id]);

  function markWatching() {
    setIsWatching(true);
    try {
      const raw = window.localStorage.getItem('wg_alerts');
      const map: Record<string, boolean> = raw ? JSON.parse(raw) : {};
      map[game.id] = true;
      window.localStorage.setItem('wg_alerts', JSON.stringify(map));
    } catch {/* private mode */}
  }

  // Share handler — the growth loop. On mobile the Web Share API hands
  // the generated PNG straight to iMessage / Instagram / group chats;
  // on desktop we open the image + copy the link as a fallback. The
  // image itself (/api/share/<id>) carries the matchup, score, verdict,
  // and price so a screenshot in a group chat stands alone.
  async function handleShare() {
    setShareState('working');
    const shareUrl = 'https://www.worthgoing.to';
    try {
      const res = await fetch(`/api/share/${game.id}`);
      const blob = await res.blob();
      const file = new File([blob], `worthgoing-${game.id}.png`, { type: 'image/png' });
      const text = insights?.verdict
        ? `${insights.verdict} — via WorthGoing`
        : `${game.away_team_name} at ${game.home_team_name} — WorthGoing`;
      const nav = navigator as Navigator & { canShare?: (d?: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text, url: shareUrl });
        setShareState('idle');
      } else if (nav.share) {
        await nav.share({ title: 'WorthGoing', text, url: shareUrl });
        setShareState('idle');
      } else {
        window.open(`/api/share/${game.id}`, '_blank');
        await navigator.clipboard.writeText(shareUrl).catch(() => {});
        setShareState('copied');
        setTimeout(() => setShareState('idle'), 2000);
      }
    } catch {
      setShareState('idle');
    }
  }

  const callout = getCalloutBanner(score, tags, insights);
  const priceScore = Number(score?.price_score) || 0;
  const isGreatDeal = priceScore >= 8 && lowestPrice != null;
  const savings = getSavings(score, lowestPrice);
  const venue = getVenueLogistics(game.venue);

  // Only show sources we have a live price + affiliate URL for. Static
  // fallback links (no price, no commission) destroyed trust by mixing
  // "real numbers" with "Visit site" placeholders. As we add affiliate
  // partnerships (StubHub, Vivid Seats, Gametime), wire each scraper to
  // write a pricing_snapshots row with source_name + affiliate_url and
  // they'll automatically appear in this list.
  const ticketRows = all_pricing
    .filter(s => s.lowest_price != null && SOURCE_DISPLAY[s.source_name])
    .sort((a, b) => (a.lowest_price ?? 999) - (b.lowest_price ?? 999))
    .map((s, i) => {
      const meta = SOURCE_DISPLAY[s.source_name];
      return {
        key: s.source_name,
        favicon: meta.favicon,
        name: meta.label,
        price: Number(s.lowest_price) as number | null,
        url: s.affiliate_url || game.affiliate_url || '#',
        isAllin: meta.isAllin,
        capturedAt: s.captured_at ?? null,
        isCheapest: i === 0,
      };
    });

  // Unified Kayak/Skyscanner-style comparison row list:
  // 1. Every source with a live price (TickPick + SeatGeek when available)
  //    sorted ascending — cheapest at top with the badge.
  // 2. Every other partner site below, no fake prices, "Check price →"
  //    CTA. Dedupes against ticketRows so SeatGeek doesn't show twice
  //    once we have a live price for it.
  // The two used to live in visually different sections ("Live prices"
  // and "Also check"); unifying them is the single biggest visual lift
  // toward a real comparison-tool feel without affiliate revenue yet.
  type CompareRow = {
    key: string;
    favicon: string;
    name: string;
    price: number | null;
    url: string;
    isAllin?: boolean;
    capturedAt: string | null;
    isCheapest: boolean;
  };
  const compareRows: CompareRow[] = [
    ...ticketRows,
    ...PARTNER_LINKS
      .filter(p => !ticketRows.some(r => r.name === p.name))
      .map(p => {
        // Per-game deep link beats search whenever we have one. SeatGeek's
        // API stores the event URL on game.affiliate_url for every event
        // it knows about — when that's present, point the SeatGeek row
        // directly at the event instead of a search page. For other
        // partners, fall through to a matchup+date search query that
        // lands users on (or very close to) the specific game.
        const isSeatGeek = p.name === 'SeatGeek';
        const deepLink = isSeatGeek && game.affiliate_url?.includes('seatgeek.com')
          ? game.affiliate_url
          : null;
        const ctx = {
          home: game.home_team_name,
          away: game.away_team_name,
          league: game.league,
          venue: game.venue,
          gameDate: new Date(game.start_time),
          abbreviation: data.home_team_abbreviation,
          externalIds: data.home_team_external_ids,
        };
        return {
          key: `partner-${p.name}`,
          favicon: p.favicon,
          name: p.name,
          price: null,
          url: deepLink ?? p.getUrl(ctx),
          isAllin: false,
          capturedAt: null,
          isCheapest: false,
        };
      }),
  ];

  return (
    <div
      className="overflow-hidden transition-all duration-200"
      style={{
        background: '#15151c',
        borderRadius: '20px',
        border: '1px solid rgba(255,255,255,0.05)',
        boxShadow: '0 2px 24px rgba(0,0,0,0.35)',
      }}
    >
      {/* Callout — thin accent bar, not a banner */}
      {callout && (
        <div className="flex items-center gap-2 px-6 pt-4">
          <div className="w-1 h-4 rounded-full shrink-0" style={{ background: callout.accent }} />
          <span className="text-xs font-semibold tracking-wide" style={{ color: callout.accent }}>
            {callout.text}
          </span>
        </div>
      )}

      {/* Header: Teams + Score */}
      <div className={`px-6 ${callout ? 'pt-3' : 'pt-6'} pb-4`}>
        <div className="flex items-start justify-between gap-4">

          {/* Team info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {home_team_logo && (() => {
              // Logo links to the team's official site when we have one
              // mapped; teams without an entry in TEAM_HOMEPAGE render
              // the logo unlinked (no broken click, no 404 risk).
              const logoSrc = LOGO_OVERRIDES[game.home_team_name] ?? home_team_logo;
              const homepage = TEAM_HOMEPAGE[game.home_team_name];
              const img = (
                <img
                  src={logoSrc}
                  alt={game.home_team_name}
                  className="w-11 h-11 object-contain shrink-0 mt-1"
                />
              );
              if (!homepage) return img;
              return (
                <a
                  href={homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${game.home_team_name} official site`}
                  className="shrink-0 transition-opacity duration-150 hover:opacity-80 active:opacity-60"
                  onClick={e => e.stopPropagation()}
                >
                  {img}
                </a>
              );
            })()}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium tracking-wider uppercase" style={{ color: '#6b6b78' }}>
                {game.league === 'FIFA-WC' ? 'World Cup' : game.league} · {formatDate(game.start_time, timezone)}
              </p>
              <h3
                className="mt-1 text-2xl leading-tight"
                style={{
                  color: '#fafafa',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  letterSpacing: '-0.025em',
                }}
              >
                {/* For WC games, the MARQUEE team is stored in home_team_*
                    (so its flag pulls naturally as home_team_logo); the H3
                    swaps to home_team_name to match. For everything else,
                    away_team is the visiting marquee. */}
                {(() => {
                  const marquee = game.league === 'FIFA-WC' ? game.home_team_name : game.away_team_name;
                  return marquee === 'TBD'
                    ? <span style={{ color: '#6b6b78', fontStyle: 'italic' }}>Opponent TBD</span>
                    : marquee;
                })()}
              </h3>
              <p className="text-sm mt-0.5" style={{ color: '#9090a0' }}>
                {game.league === 'FIFA-WC'
                  ? `vs ${game.away_team_name}`
                  : `@ ${game.home_team_name}`}
                {' · '}{formatTime(game.start_time, timezone)}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#6b6b78' }}>{game.venue}</p>
            </div>
          </div>

          {/* Deal Score — color-graded ring + glow. The score color is the
              same palette used in the share image, so the in-app card and
              the shareable PNG read as the same brand object. */}
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="flex flex-col items-center shrink-0"
            aria-label="Show score breakdown"
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95"
              style={{
                background: `${scoreColor(dealScore)}1f`,
                border: `2px solid ${scoreColor(dealScore)}`,
                boxShadow: `0 0 22px ${scoreColor(dealScore)}45`,
              }}
            >
              <span
                style={{
                  color: scoreColor(dealScore),
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  fontSize: '22px',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {dealScore.toFixed(1)}
              </span>
            </div>
            <span
              className="text-[10px] font-bold mt-2 uppercase tracking-wider"
              style={{ color: scoreColor(dealScore) }}
            >
              {getDealScoreLabel(dealScore)}
            </span>
          </button>
        </div>
      </div>

      {/* Score Breakdown */}
      {showBreakdown && score && (
        <div className="mx-6 mb-4 px-4 py-4 rounded-2xl space-y-2.5" style={{ background: '#1f1f28' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold" style={{ color: '#fafafa' }}>Score Breakdown</span>
            <span className="text-[10px]" style={{ color: '#6b6b78' }}>score · weight</span>
          </div>
          <ScoreBar label="Price" score={Number(score.price_score) || 0} weight={0.4} />
          <ScoreBar label="Experience" score={Number(score.experience_score) || 0} weight={0.2} />
          <ScoreBar label="Game Quality" score={Number(score.game_quality_score) || 0} weight={0.2} />
          <ScoreBar label="Timing" score={Number(score.timing_score) || 0} weight={0.1} />
          {insights?.weather_temp_f != null && (
            <ScoreBar label="Weather" score={Number(score.context_score) || 0} weight={0.1} />
          )}
          {score.reasoning_summary && (
            <p className="text-[11px] pt-2 border-t" style={{ color: '#9090a0', borderColor: 'rgba(255,255,255,0.06)' }}>
              {score.reasoning_summary}
            </p>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="mx-6" style={{ height: '1px', background: 'rgba(255,255,255,0.06)' }} />

      {/* Price + Weather */}
      <div className="px-6 py-4 flex items-start justify-between">
        <div>
          {lowestPrice ? (
            <>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-4xl"
                  style={{
                    color: isGreatDeal ? '#34c759' : '#fafafa',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 700,
                    letterSpacing: '-0.03em',
                  }}
                >
                  ${lowestPrice}
                </span>
                <span className="text-xs" style={{ color: '#9090a0' }}>
                  from · {getPricingLabel(pricing)}
                </span>
              </div>
              {savings && savings.pct >= 20 ? (
                <div className="flex items-center gap-1 mt-1.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#1f8a3d" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <span className="text-xs font-semibold" style={{ color: '#34c759' }}>
                    {savings.pct}% below typical {game.league} (${savings.avg})
                  </span>
                </div>
              ) : insights?.price_insight ? (
                <p className="text-xs mt-1" style={{ color: '#9090a0' }}>{insights.price_insight}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm" style={{ color: '#6b6b78' }}>Pricing not yet available</p>
          )}
        </div>

        {insights?.weather_temp_f != null && (
          <div className="text-right">
            <p className="text-base font-semibold" style={{ color: '#fafafa' }}>
              {insights.weather_icon} {insights.weather_temp_f}°F
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#9090a0' }}>{insights.weather_condition}</p>
          </div>
        )}
      </div>

      {/* Parking + Transit — display-only, helps with "real cost of going" */}
      {venue && (
        <div className="px-6 pb-3 flex items-center gap-3 flex-wrap text-xs">
          {/* Parking */}
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: '#9090a0' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7h4a3 3 0 010 6h-4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
            </svg>
            {venue.parking.free ? (
              <span className="font-medium" style={{ color: '#34c759' }}>Free parking</span>
            ) : (
              <span style={{ color: '#fafafa' }}>
                Parking <span style={{ color: '#7a7a85' }}>~${venue.parking.typical}</span>
              </span>
            )}
          </div>

          {/* Transit — shown when accessible AND the rating is meaningful */}
          {venue.transit.available && (venue.transit.rating === 'excellent' || venue.transit.rating === 'good') && (
            <>
              <span style={{ color: '#3a3a45' }}>·</span>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: '#0071e3' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <span style={{ color: '#0071e3' }}>{venue.transit.notes}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Promotions — render EVERY deduped promo for this game, not just
          the marquee one. dedupePromos() already collapsed exact
          duplicates and ranked by type so the most distinctive entry
          renders first. The first row shows full styling (icon + title +
          description); subsequent rows are compact (icon + title + an
          optional short detail) so two-to-five promos stack cleanly
          without overwhelming the card. promo_clarity from insights
          decorates only the FIRST row — it's a single-sentence summary
          intended for the marquee item, not every entry. */}
      {dedupedPromos.length > 0 ? (
        <div
          className="mx-6 mb-4 px-4 py-3 rounded-2xl"
          style={{ background: 'rgba(255,159,10,0.06)', border: '1px solid rgba(255,159,10,0.18)' }}
        >
          {dedupedPromos.map((promo, i) => {
            const isFirst = i === 0;
            // Always use the promo's own description — never the
            // enrichment-AI promo_clarity, which is a single-line
            // summary of ALL promos on the date and ends up cross-
            // referencing the other rows below it ("the t-shirt plus
            // the $3 concessions and the Harry Potter jersey…"), which
            // is exactly the repetition the user complained about.
            // promo_clarity stays in the DB for future single-promo
            // surfaces but no longer leaks into the per-row UI.
            const detail = getPromoDetail(promo, null);
            return (
              <div
                key={`${promo.promo_type}-${promo.promo_item ?? ''}-${i}`}
                className={`flex items-start gap-3 ${isFirst ? '' : 'mt-2.5 pt-2.5 border-t border-[rgba(255,159,10,0.14)]'}`}
              >
                <div className="shrink-0 mt-0.5" style={{ color: '#ffb347' }}>
                  <PromoIcon type={promo.promo_type} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#ffb347' }}>
                    {getPromoTitle(promo)}
                  </p>
                  {detail && (
                    <p className="text-xs mt-1 leading-snug" style={{ color: '#ffd180' }}>
                      {detail}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : ((insights?.context_flags as string[] | undefined)?.includes('playoff') && (
        // Playoffs almost always have a giveaway, but teams often don't
        // publish the specific item ahead of time (or our scrape catches
        // a stale item from a prior round). Show a hedged label rather
        // than risk an inaccurate one — admins can edit in the real
        // item once it's confirmed.
        <div
          className="mx-6 mb-4 px-4 py-3 rounded-2xl flex items-start gap-3"
          style={{ background: 'rgba(255,159,10,0.06)', border: '1px solid rgba(255,159,10,0.18)' }}
        >
          <div className="shrink-0 mt-0.5" style={{ color: '#ffb347' }}>
            <PromoIcon type="giveaway" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#ffb347' }}>
              Playoff giveaway expected
            </p>
            <p className="text-xs mt-1 leading-snug" style={{ color: '#ffd180' }}>
              Item TBD — check the team&rsquo;s site closer to game day.
            </p>
          </div>
        </div>
      ))}

      {/* Verdict — the opinionated recommendation (should you go).
          Kept bold so it reads as the headline / pull-quote. */}
      {insights?.verdict && (
        <div className="px-6 pb-3">
          <p className="text-sm font-semibold leading-snug" style={{ color: '#fafafa' }}>
            {insights.verdict}
          </p>
        </div>
      )}

      {/* Why worth it — the specific factual hook that backs the
          verdict. Muted body weight so the two blocks read as
          headline + supporting line, not two competing voices. The
          prompt enforces that these two fields carry DIFFERENT angles
          (recommendation vs. specific reason). */}
      {insights?.why_worth_it && (
        <div className="px-6 pb-4">
          <p className="text-sm leading-relaxed" style={{ color: '#9090a0' }}>
            {insights.why_worth_it}
          </p>
        </div>
      )}

      {/* Ticket CTA + Share */}
      <div className="px-6 pb-6">
        <div className="flex items-stretch gap-2 min-w-0">
          <button
            onClick={() => setShowTickets(!showTickets)}
            className="flex-1 min-w-0 flex items-center justify-between gap-2 py-3.5 px-4 font-semibold text-sm transition-all duration-150 active:scale-[0.98]"
            style={{
              background: '#fafafa',
              color: '#0a0a0d',
              borderRadius: '100px',
            }}
          >
            {/* min-w-0 + truncate keeps the row from blowing past viewport
                width when a 4-digit price + slang prefix lands on a narrow
                phone. The "from" word was the tipping point — dropping it
                shaves ~25px and still reads natural. */}
            <span className="truncate">{lowestPrice ? `Lock it in · $${lowestPrice}` : 'See tickets'}</span>
            <svg
              className={`w-4 h-4 shrink-0 transition-transform duration-200 ${showTickets ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {/* Price-drop alert signup. Bell fills + turns green once the
              visitor has subscribed (persisted in localStorage so it
              survives reloads without a server query). Clicking again
              just re-opens the modal — server idempotently handles a
              re-submit of an already-active alert. */}
          <button
            onClick={() => setShowAlertModal(true)}
            aria-label={isWatching ? 'Already watching this game' : 'Get price-drop alerts'}
            className="shrink-0 flex items-center justify-center transition-all duration-150 active:scale-[0.95]"
            style={{
              width: '44px',
              background: isWatching ? 'rgba(52,199,89,0.14)' : '#262630',
              color: isWatching ? '#34c759' : '#fafafa',
              borderRadius: '100px',
              border: `1px solid ${isWatching ? 'rgba(52,199,89,0.35)' : 'rgba(255,255,255,0.05)'}`,
            }}
          >
            <svg className="w-5 h-5" fill={isWatching ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
            </svg>
          </button>
          {/* Share — generates a branded card PNG and hands it to the
              native share sheet on mobile (iMessage / Instagram / group
              chats) or copies the link on desktop. */}
          <button
            onClick={handleShare}
            disabled={shareState === 'working'}
            aria-label="Share this game"
            className="shrink-0 flex items-center justify-center transition-all duration-150 active:scale-[0.95]"
            style={{
              width: '44px',
              background: '#262630',
              color: '#fafafa',
              borderRadius: '100px',
              border: '1px solid rgba(255,255,255,0.05)',
            }}
          >
            {shareState === 'working' ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
              </svg>
            ) : shareState === 'copied' ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.4 20.6L21 12 3.4 3.4 3 10l13 2-13 2 .4 6.6z" />
              </svg>
            )}
          </button>
        </div>

        {showTickets && (
          <div className="mt-3 rounded-2xl overflow-hidden" style={{ background: '#1f1f28' }}>
            {/* Unified comparison — every source as a first-class row */}
            <div className="px-4 pt-3 pb-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#6b6b78' }}>
                Compare prices
              </p>
            </div>
            <div className="px-3 pb-1 divide-y" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
              {compareRows.map(row => (
                <TicketSourceRow
                  key={row.key}
                  favicon={row.favicon}
                  name={row.name}
                  price={row.price}
                  url={row.url}
                  isAllin={row.isAllin}
                  capturedAt={row.capturedAt}
                  isCheapest={row.isCheapest}
                />
              ))}
            </div>
            <div className="px-4 pt-2 pb-3">
              <p className="text-[10px] leading-snug" style={{ color: '#6b6b78' }}>
                ALL-IN means the price shown is what you pay; otherwise expect fees at checkout. &ldquo;Check price&rdquo; opens that source directly — live pricing for those is coming soon.
              </p>
            </div>
          </div>
        )}
      </div>

      {showAlertModal && (
        <AlertModal
          gameId={game.id}
          matchupTitle={(() => {
            const isWC = game.league === 'FIFA-WC';
            const marquee = isWC ? game.home_team_name : game.away_team_name;
            const opponent = isWC ? game.away_team_name : game.home_team_name;
            return isWC ? `${marquee} vs ${opponent}` : `${marquee} at ${opponent}`;
          })()}
          onClose={() => setShowAlertModal(false)}
          onSubscribed={markWatching}
        />
      )}
    </div>
  );
}
