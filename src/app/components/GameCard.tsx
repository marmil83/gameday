'use client';

import { useState } from 'react';
import type { GameCard as GameCardType, PricingSnapshot } from '@/types/database';
import { PRICING_LABELS } from '@/lib/constants';
import { getVenueLogistics } from '@/lib/venues';

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

// Partner deep-links — shown beneath the live-pricing rows in a clearly
// secondary treatment. They're search-page links (no live price), but
// surfacing them lets visitors cross-shop manually until we have
// affiliate API access for live data on each.
interface PartnerLink {
  name: string;
  favicon: string;
  getUrl: (homeTeam: string) => string;
}

const PARTNER_LINKS: PartnerLink[] = [
  {
    name: 'StubHub',
    favicon: 'https://www.stubhub.com/favicon.ico',
    getUrl: (home) => `https://www.stubhub.com/${home.toLowerCase().replace(/\s+/g, '-')}-tickets/`,
  },
  {
    name: 'Vivid Seats',
    favicon: 'https://www.vividseats.com/favicon.ico',
    getUrl: (home) => `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(home)}`,
  },
  {
    name: 'Gametime',
    favicon: 'https://gametime.co/favicon.ico',
    getUrl: (home) => `https://gametime.co/events?q=${encodeURIComponent(home)}`,
  },
  {
    name: 'SeatGeek',
    favicon: 'https://seatgeek.com/favicon.ico',
    getUrl: (home) => `https://seatgeek.com/${home.toLowerCase().replace(/\s+/g, '-')}-tickets`,
  },
  {
    name: 'Ticketmaster',
    favicon: 'https://www.ticketmaster.com/favicon.ico',
    getUrl: (home) => `https://www.ticketmaster.com/${home.toLowerCase().replace(/\s+/g, '-')}-tickets/`,
  },
];

/** Relative time + freshness color from a captured_at ISO timestamp. */
function freshness(capturedAt: string | null | undefined): { label: string; color: string } {
  if (!capturedAt) return { label: 'unknown', color: '#aeaeb2' };
  const ageMs = Date.now() - new Date(capturedAt).getTime();
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 60) return { label: `${Math.max(1, mins)}m ago`, color: '#1f8a3d' };
  const hours = Math.floor(mins / 60);
  if (hours < 12) return { label: `${hours}h ago`, color: hours <= 4 ? '#1f8a3d' : '#86868b' };
  const days = Math.floor(hours / 24);
  if (days < 1) return { label: `${hours}h ago`, color: '#bf6900' };
  return { label: `${days}d ago`, color: '#bf6900' };
}

// Two-row layout (works at any width):
//   [icon] TickPick                       from $29 →
//          ALL-IN · CHEAPEST                 12m ago
// Avoids the mobile bug where ALL-IN/CHEAPEST competed with the price
// for horizontal space and wrapped into a misshapen pill.
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
  price: number;
  url: string;
  isAllin?: boolean;
  capturedAt: string | null;
  isCheapest: boolean;
}) {
  const fresh = freshness(capturedAt);
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
        <span className="text-sm font-medium" style={{ color: '#1d1d1f' }}>{name}</span>
        {(isAllin || isCheapest) && (
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {isAllin && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(31,138,61,0.12)', color: '#1f8a3d', whiteSpace: 'nowrap' }}
                title="Price shown is what you pay — no fees added"
              >
                ALL-IN
              </span>
            )}
            {isCheapest && (
              <span
                className="text-[10px] font-semibold uppercase tracking-wide"
                style={{ color: '#1f8a3d', whiteSpace: 'nowrap' }}
              >
                cheapest
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end shrink-0 gap-0.5">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold" style={{ color: '#1d1d1f', whiteSpace: 'nowrap' }}>from ${price}</span>
          <svg className="w-3.5 h-3.5 ml-0.5" style={{ color: '#aeaeb2' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </div>
        <span className="text-[10px]" style={{ color: fresh.color, whiteSpace: 'nowrap' }}>{fresh.label}</span>
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
        style={{ background: '#1d1d1f', color: '#fff' }}
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

// Smaller variant for the partner pills (3.5×3.5 instead of 5×5).
function PartnerPillFavicon({ src, name }: { src: string; name: string }) {
  const [errored, setErrored] = useState(false);
  if (errored || !src) {
    return (
      <div
        className="w-3.5 h-3.5 rounded shrink-0 flex items-center justify-center text-[8px] font-bold"
        style={{ background: '#1d1d1f', color: '#fff' }}
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
      className="w-3.5 h-3.5 rounded object-contain shrink-0"
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
  if (score >= 8) return 'Great Deal';
  if (score >= 6) return 'Good Deal';
  if (score >= 4) return 'Fair';
  return 'Below Avg';
}

function getPricingLabel(pricing: GameCardType['pricing']): string {
  if (!pricing?.displayed_price) return '';
  return PRICING_LABELS[pricing.pricing_transparency] || 'before fees';
}

function ScoreBar({ label, score, weight }: { label: string; score: number; weight: number }) {
  const pct = (score / 10) * 100;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-20 shrink-0" style={{ color: '#86868b' }}>{label}</span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#F2F2F7' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: '#1d1d1f' }}
        />
      </div>
      <span className="w-8 text-right font-medium" style={{ color: '#1d1d1f' }}>{score.toFixed(1)}</span>
      <span className="w-8 text-right" style={{ color: '#aeaeb2' }}>{Math.round(weight * 100)}%</span>
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

  if (contextFlags.includes('game-7'))        return { text: 'Game 7', accent: '#ff3b30' };
  if (contextFlags.includes('elimination'))   return { text: 'Elimination Game', accent: '#ff3b30' };
  if (contextFlags.includes('finals'))        return { text: 'Finals', accent: '#ff3b30' };
  if (contextFlags.includes('conference-finals')) return { text: 'Conference Finals', accent: '#ff9500' };
  if (contextFlags.includes('playoff'))       return { text: 'Playoff Game', accent: '#ff9500' };
  if (contextFlags.includes('rivalry'))       return { text: 'Rivalry Game', accent: '#af52de' };
  if (contextFlags.includes('opening-day'))   return { text: 'Opening Day', accent: '#0071e3' };
  if (priceScore >= 9 || tagNames.includes('cheap-night')) return { text: 'Value Game', accent: '#34c759' };
  return null;
}

export default function GameCard({ data, timezone }: { data: GameCardType; timezone?: string }) {
  const { game, pricing, all_pricing = [], promotions, score, tags, insights, home_team_logo, away_team_logo } = data;
  const dealScore = Number(score?.deal_score) || 0;
  const topPromo = promotions?.[0];
  const lowestPrice = pricing ? Number(pricing.lowest_price || pricing.displayed_price) : null;
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showTickets, setShowTickets] = useState(false);

  const callout = getCalloutBanner(score, tags, insights);
  const priceScore = Number(score?.price_score) || 0;
  const isGreatDeal = priceScore >= 8 && lowestPrice != null;
  const savings = getSavings(score, lowestPrice);
  const extraPromoCount = (promotions?.length || 0) - 1;
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
        price: Number(s.lowest_price),
        url: s.affiliate_url || game.affiliate_url || '#',
        isAllin: meta.isAllin,
        capturedAt: s.captured_at ?? null,
        isCheapest: i === 0,
      };
    });

  return (
    <div
      className="bg-white overflow-hidden transition-all duration-200"
      style={{ borderRadius: '20px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
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
            {home_team_logo && (
              <img
                src={home_team_logo}
                alt={game.home_team_name}
                className="w-11 h-11 object-contain shrink-0 mt-1"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium tracking-wider uppercase" style={{ color: '#aeaeb2' }}>
                {game.league} · {formatDate(game.start_time, timezone)}
              </p>
              <h3 className="mt-1 text-xl font-bold tracking-tight leading-tight" style={{ color: '#1d1d1f' }}>
                {game.away_team_name === 'TBD'
                  ? <span style={{ color: '#aeaeb2', fontStyle: 'italic' }}>Opponent TBD</span>
                  : game.away_team_name}
              </h3>
              <p className="text-sm mt-0.5" style={{ color: '#86868b' }}>
                @ {game.home_team_name} · {formatTime(game.start_time, timezone)}
              </p>
              <p className="text-xs mt-0.5" style={{ color: '#aeaeb2' }}>{game.venue}</p>
            </div>
          </div>

          {/* Deal Score — clean black circle */}
          <button
            onClick={() => setShowBreakdown(!showBreakdown)}
            className="flex flex-col items-center shrink-0"
            aria-label="Show score breakdown"
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center transition-transform duration-150 active:scale-95"
              style={{ background: '#1d1d1f' }}
            >
              <span className="text-lg font-bold text-white">{dealScore.toFixed(1)}</span>
            </div>
            <span className="text-[10px] font-medium mt-1.5" style={{ color: '#86868b' }}>
              {getDealScoreLabel(dealScore)}
            </span>
          </button>
        </div>
      </div>

      {/* Score Breakdown */}
      {showBreakdown && score && (
        <div className="mx-6 mb-4 px-4 py-4 rounded-2xl space-y-2.5" style={{ background: '#F2F2F7' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold" style={{ color: '#1d1d1f' }}>Score Breakdown</span>
            <span className="text-[10px]" style={{ color: '#aeaeb2' }}>score · weight</span>
          </div>
          <ScoreBar label="Price" score={Number(score.price_score) || 0} weight={0.4} />
          <ScoreBar label="Experience" score={Number(score.experience_score) || 0} weight={0.2} />
          <ScoreBar label="Game Quality" score={Number(score.game_quality_score) || 0} weight={0.2} />
          <ScoreBar label="Timing" score={Number(score.timing_score) || 0} weight={0.1} />
          {insights?.weather_temp_f != null && (
            <ScoreBar label="Weather" score={Number(score.context_score) || 0} weight={0.1} />
          )}
          {score.reasoning_summary && (
            <p className="text-[11px] pt-2 border-t" style={{ color: '#86868b', borderColor: 'rgba(0,0,0,0.06)' }}>
              {score.reasoning_summary}
            </p>
          )}
        </div>
      )}

      {/* Divider */}
      <div className="mx-6" style={{ height: '1px', background: 'rgba(0,0,0,0.05)' }} />

      {/* Price + Weather */}
      <div className="px-6 py-4 flex items-start justify-between">
        <div>
          {lowestPrice ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tracking-tight" style={{ color: isGreatDeal ? '#1f8a3d' : '#1d1d1f' }}>
                  ${lowestPrice}
                </span>
                <span className="text-xs" style={{ color: '#86868b' }}>
                  from · {getPricingLabel(pricing)}
                </span>
              </div>
              {savings && savings.pct >= 20 ? (
                <div className="flex items-center gap-1 mt-1.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="#1f8a3d" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  <span className="text-xs font-semibold" style={{ color: '#1f8a3d' }}>
                    {savings.pct}% below typical {game.league} (${savings.avg})
                  </span>
                </div>
              ) : insights?.price_insight ? (
                <p className="text-xs mt-1" style={{ color: '#86868b' }}>{insights.price_insight}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm" style={{ color: '#aeaeb2' }}>Pricing not yet available</p>
          )}
        </div>

        {insights?.weather_temp_f != null && (
          <div className="text-right">
            <p className="text-base font-semibold" style={{ color: '#1d1d1f' }}>
              {insights.weather_icon} {insights.weather_temp_f}°F
            </p>
            <p className="text-xs mt-0.5" style={{ color: '#86868b' }}>{insights.weather_condition}</p>
          </div>
        )}
      </div>

      {/* Parking + Transit — display-only, helps with "real cost of going" */}
      {venue && (
        <div className="px-6 pb-3 flex items-center gap-3 flex-wrap text-xs">
          {/* Parking */}
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: '#86868b' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17V7h4a3 3 0 010 6h-4M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
            </svg>
            {venue.parking.free ? (
              <span className="font-medium" style={{ color: '#1f8a3d' }}>Free parking</span>
            ) : (
              <span style={{ color: '#1d1d1f' }}>
                Parking <span className="text-[#86868b]">~${venue.parking.typical}</span>
              </span>
            )}
          </div>

          {/* Transit — shown when accessible AND the rating is meaningful */}
          {venue.transit.available && (venue.transit.rating === 'excellent' || venue.transit.rating === 'good') && (
            <>
              <span style={{ color: '#d2d2d7' }}>·</span>
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

      {/* Promo */}
      {topPromo && (
        <div
          className="mx-6 mb-4 px-4 py-3 rounded-2xl flex items-start gap-3"
          style={{ background: '#FFF9EC', border: '1px solid rgba(255,149,0,0.15)' }}
        >
          <div className="shrink-0 mt-0.5" style={{ color: '#bf6900' }}>
            <PromoIcon type={topPromo.promo_type} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: '#bf6900' }}>
                {getPromoTitle(topPromo)}
              </p>
              {extraPromoCount > 0 && (
                <span
                  className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{ background: 'rgba(191,105,0,0.12)', color: '#bf6900' }}
                >
                  +{extraPromoCount} more
                </span>
              )}
            </div>
            {getPromoDetail(topPromo, insights?.promo_clarity) && (
              <p className="text-xs mt-1 leading-snug" style={{ color: '#8a5500' }}>
                {getPromoDetail(topPromo, insights?.promo_clarity)}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Verdict */}
      {insights?.verdict && (
        <div className="px-6 pb-3">
          <p className="text-sm font-semibold leading-snug" style={{ color: '#1d1d1f' }}>
            {insights.verdict}
          </p>
        </div>
      )}

      {/* Why worth it */}
      {insights?.why_worth_it && (
        <div className="px-6 pb-4">
          <p className="text-sm leading-relaxed" style={{ color: '#86868b' }}>
            {insights.why_worth_it}
          </p>
        </div>
      )}

      {/* Tags */}
      {(tags?.length || insights?.effort_level) && (
        <div className="px-6 pb-4 flex flex-wrap gap-2">
          {tags?.map((tag) => (
            <span
              key={tag.tag_name}
              className="px-3 py-1 text-xs font-medium rounded-full"
              style={{ background: '#F2F2F7', color: '#86868b' }}
            >
              {tag.tag_name}
            </span>
          ))}
          {insights?.effort_level && (
            <span
              className="px-3 py-1 text-xs font-medium rounded-full"
              style={{ background: '#F2F2F7', color: '#86868b' }}
            >
              {insights.effort_level === 'easy' ? 'Easy outing' :
               insights.effort_level === 'high_effort' ? 'Plan ahead' : 'Moderate effort'}
            </span>
          )}
        </div>
      )}

      {/* Ticket CTA */}
      <div className="px-6 pb-6">
        <button
          onClick={() => setShowTickets(!showTickets)}
          className="w-full flex items-center justify-between py-3.5 px-5 font-semibold text-sm transition-all duration-150 active:scale-[0.98]"
          style={{
            background: '#1d1d1f',
            color: '#ffffff',
            borderRadius: '100px',
          }}
        >
          <span>{lowestPrice ? `Get Tickets · from $${lowestPrice}` : 'View Tickets'}</span>
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${showTickets ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showTickets && (
          <div className="mt-3 rounded-2xl overflow-hidden" style={{ background: '#F2F2F7' }}>
            {/* Live-priced sources */}
            <div className="px-4 pt-3 pb-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#aeaeb2' }}>
                Live prices
              </p>
            </div>
            {ticketRows.length > 0 ? (
              <div className="px-3 pb-1 divide-y" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                {ticketRows.map(row => (
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
            ) : (
              <div className="px-4 py-3">
                <p className="text-xs" style={{ color: '#86868b' }}>No live pricing yet — check back soon.</p>
              </div>
            )}

            {/* Partner search links — secondary treatment, no fake prices */}
            <div className="px-4 pt-3 pb-1 border-t" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#aeaeb2' }}>
                Also check
              </p>
            </div>
            <div className="px-3 pb-2">
              <div className="flex flex-wrap gap-1.5 px-1 py-1">
                {PARTNER_LINKS
                  .filter(p => !ticketRows.some(r => r.name === p.name))
                  .map(p => (
                    <a
                      key={p.name}
                      href={p.getUrl(game.home_team_name)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full transition-colors"
                      style={{ background: '#ffffff', border: '1px solid rgba(0,0,0,0.06)' }}
                    >
                      <PartnerPillFavicon src={p.favicon} name={p.name} />
                      <span className="text-xs" style={{ color: '#1d1d1f', whiteSpace: 'nowrap' }}>{p.name}</span>
                      <svg className="w-2.5 h-2.5" style={{ color: '#aeaeb2' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </a>
                  ))}
              </div>
            </div>
            <div className="px-4 pb-3 space-y-1">
              <p className="text-[10px] leading-snug" style={{ color: '#aeaeb2' }}>
                ALL-IN means the price shown is what you pay; otherwise expect fees at checkout. &ldquo;Also check&rdquo; opens partner search pages — live pricing for these is coming soon.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
