'use client';

import { useState } from 'react';
import type { GameCard as GameCardType, PricingSnapshot } from '@/types/database';
import { PRICING_LABELS } from '@/lib/constants';

// ── Ticket source config ────────────────────────────────────
// DB-sourced entries (TickPick, SeatGeek) are merged in at render time.
// Static entries provide "Visit site" fallback links for major brokers.

interface StaticSource {
  name: string;
  favicon: string;
  label?: string;                           // e.g. "Official seller"
  getUrl: (homeTeam: string, awayTeam: string) => string;
}

const STATIC_TICKET_SOURCES: StaticSource[] = [
  {
    name: 'StubHub',
    favicon: 'https://www.stubhub.com/favicon.ico',
    getUrl: (home) =>
      `https://www.stubhub.com/${home.toLowerCase().replace(/\s+/g, '-')}-tickets/`,
  },
  {
    name: 'Vivid Seats',
    favicon: 'https://www.vividseats.com/favicon.ico',
    getUrl: (home) =>
      `https://www.vividseats.com/search?searchTerm=${encodeURIComponent(home)}`,
  },
  {
    name: 'Gametime',
    favicon: 'https://gametime.co/favicon.ico',
    getUrl: (home) =>
      `https://gametime.co/events?q=${encodeURIComponent(home)}`,
  },
  {
    name: 'Ticketmaster',
    favicon: 'https://www.ticketmaster.com/favicon.ico',
    label: 'Official seller',
    getUrl: (home) =>
      `https://www.ticketmaster.com/${home.toLowerCase().replace(/\s+/g, '-')}-tickets/`,
  },
  {
    name: 'SeatGeek',
    favicon: 'https://seatgeek.com/favicon.ico',
    getUrl: (home) =>
      `https://seatgeek.com/${home.toLowerCase().replace(/\s+/g, '-')}-tickets`,
  },
];

const SOURCE_DISPLAY: Record<string, { label: string; favicon: string; isAllin?: boolean }> = {
  tickpick: {
    label: 'TickPick',
    favicon: 'https://www.tickpick.com/favicon.ico',
    isAllin: true,
  },
  seatgeek: {
    label: 'SeatGeek',
    favicon: 'https://seatgeek.com/favicon.ico',
  },
};

function TicketSourceRow({
  favicon,
  name,
  price,
  badge,
  url,
  isAllin,
}: {
  favicon: string;
  name: string;
  price?: number | null;
  badge?: string;
  url: string;
  isAllin?: boolean;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 py-2.5 px-1 hover:bg-gray-50 rounded-lg transition-colors group"
    >
      {/* Favicon */}
      <img
        src={favicon}
        alt={name}
        className="w-5 h-5 rounded object-contain shrink-0"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />

      {/* Name + badge */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-800">{name}</span>
        {badge && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 border border-blue-200 rounded-full px-1.5 py-0.5 shrink-0">
            <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {badge}
          </span>
        )}
        {isAllin && (
          <span className="text-[10px] text-emerald-600 font-medium shrink-0">all-in</span>
        )}
      </div>

      {/* Price or Visit site */}
      <div className="flex items-center gap-1.5 shrink-0">
        {price != null ? (
          <span className="text-sm font-bold text-gray-900">from ${price}</span>
        ) : (
          <span className="text-sm text-blue-600 font-medium">Visit site</span>
        )}
        <svg className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </a>
  );
}

function formatTime(isoString: string, timezone?: string): string {
  const date = new Date(isoString);
  // Detect placeholder times (e.g. midnight or 3:30 AM local = TBD from SeatGeek)
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

function getDealScoreColor(score: number): string {
  if (score >= 8) return 'bg-emerald-500';
  if (score >= 6) return 'bg-green-500';
  if (score >= 4) return 'bg-yellow-500';
  return 'bg-gray-400';
}

function getDealScoreLabel(score: number): string {
  if (score >= 8) return 'Great Deal';
  if (score >= 6) return 'Good Deal';
  if (score >= 4) return 'Fair';
  return 'Below Avg';
}

function getPricingLabel(pricing: GameCardType['pricing']): string {
  if (!pricing?.displayed_price) return '';
  const label = PRICING_LABELS[pricing.pricing_transparency] || 'before fees';
  return label;
}

function getWeatherColor(score: number): string {
  if (score >= 8) return 'text-emerald-600';
  if (score >= 6) return 'text-green-600';
  if (score >= 4) return 'text-yellow-600';
  return 'text-red-600';
}

function ScoreBar({ label, score, weight }: { label: string; score: number; weight: number }) {
  const pct = (score / 10) * 100;
  const color = score >= 7 ? 'bg-emerald-500' : score >= 5 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 text-gray-500 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right font-medium text-gray-700">{score.toFixed(1)}</span>
      <span className="w-8 text-right text-gray-400">{Math.round(weight * 100)}%</span>
    </div>
  );
}

// Returns a highlighted banner label when a game is an exceptional value or high-stakes event.
// Only one banner is shown — playoff/big game takes priority over price.
function getCalloutBanner(
  score: GameCardType['score'],
  tags: GameCardType['tags'],
  insights: GameCardType['insights'],
): { text: string; className: string } | null {
  const priceScore = Number(score?.price_score) || 0;
  const contextFlags = (insights?.context_flags as string[]) || [];
  const tagNames = tags?.map(t => t.tag_name) || [];

  if (contextFlags.includes('game-7'))
    return { text: '🏆 Game 7', className: 'bg-red-600 text-white' };
  if (contextFlags.includes('elimination'))
    return { text: '⚡ Elimination Game', className: 'bg-red-600 text-white' };
  if (contextFlags.includes('finals'))
    return { text: '🏆 Finals', className: 'bg-red-600 text-white' };
  if (contextFlags.includes('conference-finals'))
    return { text: '🏆 Conference Finals', className: 'bg-orange-600 text-white' };
  if (contextFlags.includes('playoff'))
    return { text: '🏒 Playoff Game', className: 'bg-orange-500 text-white' };
  if (contextFlags.includes('rivalry'))
    return { text: '🔥 Rivalry Game', className: 'bg-purple-600 text-white' };
  if (contextFlags.includes('opening-day'))
    return { text: '⚾ Opening Day', className: 'bg-blue-600 text-white' };
  if (priceScore >= 9 || tagNames.includes('cheap-night'))
    return { text: '💰 Value Game', className: 'bg-emerald-600 text-white' };
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

  // Build the merged ticket source list:
  // 1. DB-sourced snapshots (TickPick, SeatGeek) with real prices
  // 2. Static broker links for everything else
  const dbSourceNames = new Set(all_pricing.map(s => s.source_name));

  // Priced rows from DB, sorted cheapest first
  const pricedRows = all_pricing
    .filter(s => s.lowest_price != null)
    .sort((a, b) => (a.lowest_price ?? 999) - (b.lowest_price ?? 999))
    .map(s => {
      const meta = SOURCE_DISPLAY[s.source_name] ?? {
        label: s.source_name,
        favicon: '',
        isAllin: false,
      };
      return {
        key: s.source_name,
        favicon: meta.favicon,
        name: meta.label,
        price: Number(s.lowest_price),
        url: s.affiliate_url || game.affiliate_url || '#',
        isAllin: meta.isAllin,
        badge: undefined as string | undefined,
      };
    });

  // "Visit site" rows for DB sources without price (e.g. SeatGeek returning null for playoffs)
  const noPriceDbRows = all_pricing
    .filter(s => s.lowest_price == null && s.affiliate_url)
    .map(s => {
      const meta = SOURCE_DISPLAY[s.source_name] ?? { label: s.source_name, favicon: '' };
      return {
        key: s.source_name,
        favicon: meta.favicon,
        name: meta.label,
        price: null as number | null,
        url: s.affiliate_url!,
        isAllin: false,
        badge: undefined as string | undefined,
      };
    });

  // Static broker rows — skip any that are already in the DB
  const staticRows = STATIC_TICKET_SOURCES
    .filter(src => !dbSourceNames.has(src.name.toLowerCase().replace(/\s+/g, '')))
    .map(src => ({
      key: src.name,
      favicon: src.favicon,
      name: src.name,
      price: null as number | null,
      url: src.getUrl(game.home_team_name, game.away_team_name),
      isAllin: false,
      badge: src.label,
    }));

  const allTicketRows = [...pricedRows, ...noPriceDbRows, ...staticRows];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
      {/* Callout banner (Value Game, Playoff, Rivalry, etc.) */}
      {callout && (
        <div className={`px-5 py-1.5 text-xs font-bold tracking-wide ${callout.className}`}>
          {callout.text}
        </div>
      )}

      {/* Header: Teams + Time */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            {/* Home Team Logo */}
            {home_team_logo && (
              <img
                src={home_team_logo}
                alt={game.home_team_name}
                className="w-10 h-10 object-contain shrink-0 mt-3"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                {game.league} &middot; {formatDate(game.start_time, timezone)}
              </p>
              <h3 className="mt-1 text-lg font-bold text-gray-900">
                {game.away_team_name === 'TBD'
                  ? <span className="text-gray-400 italic">Opponent TBD</span>
                  : game.away_team_name}
              </h3>
              <p className="text-sm text-gray-500">
                @ {game.home_team_name} &middot; {formatTime(game.start_time, timezone)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">{game.venue}</p>
            </div>
          </div>

          {/* Deal Score Badge (clickable) */}
          <button
            className="flex flex-col items-center ml-4 cursor-pointer"
            onClick={() => setShowBreakdown(!showBreakdown)}
            aria-label="Show score breakdown"
          >
            <div
              className={`w-14 h-14 rounded-xl ${getDealScoreColor(dealScore)} flex items-center justify-center ring-2 ring-transparent hover:ring-gray-300 transition-all`}
            >
              <span className="text-xl font-bold text-white">
                {dealScore.toFixed(1)}
              </span>
            </div>
            <span className="text-[10px] font-medium text-gray-500 mt-1">
              {getDealScoreLabel(dealScore)}
            </span>
          </button>
        </div>
      </div>

      {/* Score Breakdown (toggled by clicking score badge) */}
      {showBreakdown && score && (
        <div className="mx-5 mb-3 px-4 py-3 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-gray-700">Deal Score Breakdown</span>
            <span className="text-[10px] text-gray-400">score &middot; weight</span>
          </div>
          <ScoreBar label="Price" score={Number(score.price_score) || 0} weight={0.4} />
          <ScoreBar label="Experience" score={Number(score.experience_score) || 0} weight={0.2} />
          <ScoreBar label="Game Quality" score={Number(score.game_quality_score) || 0} weight={0.2} />
          <ScoreBar label="Timing" score={Number(score.timing_score) || 0} weight={0.1} />
          {insights?.weather_temp_f != null && (
            <ScoreBar label="Weather" score={Number(score.context_score) || 0} weight={0.1} />
          )}
          {score.reasoning_summary && (
            <p className="text-[11px] text-gray-400 pt-1 border-t border-gray-100">
              {score.reasoning_summary}
            </p>
          )}
        </div>
      )}

      {/* Price + Weather row */}
      <div className="px-5 pb-3 flex items-start justify-between">
        {/* Price */}
        <div>
          {lowestPrice ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-gray-900">
                  From ${lowestPrice}
                </span>
                <span className="text-xs text-gray-400">
                  {getPricingLabel(pricing)}
                </span>
              </div>
              {insights?.price_insight && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {insights.price_insight}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">Price not yet available</p>
          )}
        </div>

        {/* Weather (outdoor games only) */}
        {insights?.weather_temp_f != null && (
          <div className={`text-right ${getWeatherColor(Number(insights.weather_score) || 5)}`}>
            <p className="text-lg font-semibold">
              {insights.weather_icon} {insights.weather_temp_f}°F
            </p>
            <p className="text-[11px]">
              {insights.weather_condition}
            </p>
          </div>
        )}
      </div>

      {/* Promo highlight */}
      {topPromo && (
        <div className="mx-5 mb-3 px-3 py-2 bg-amber-50 rounded-lg border border-amber-100">
          <p className="text-xs font-semibold text-amber-700">
            {topPromo.promo_type === 'giveaway' ? '🎁' : '⭐'}{' '}
            {insights?.promo_clarity || topPromo.promo_description || topPromo.promo_item}
          </p>
        </div>
      )}

      {/* Verdict */}
      {insights?.verdict && (
        <div className="px-5 pb-3">
          <p className="text-sm font-semibold text-gray-800 italic">
            &ldquo;{insights.verdict}&rdquo;
          </p>
        </div>
      )}

      {/* Why worth it */}
      {insights?.why_worth_it && (
        <div className="px-5 pb-3">
          <p className="text-sm text-gray-600">
            {insights.why_worth_it}
          </p>
        </div>
      )}

      {/* Tags + Effort */}
      <div className="px-5 pb-3 flex flex-wrap items-center gap-2">
        {tags?.map((tag) => (
          <span
            key={tag.tag_name}
            className="inline-block px-2.5 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700"
          >
            {tag.tag_name}
          </span>
        ))}
        {insights?.effort_level && (
          <span className="inline-block px-2.5 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
            {insights.effort_level === 'easy' ? 'Easy outing' :
             insights.effort_level === 'high_effort' ? 'Plan ahead' : 'Moderate effort'}
          </span>
        )}
      </div>

      {/* Ticket comparison CTA */}
      <div className="px-5 pb-5">
        {/* Toggle button */}
        <button
          onClick={() => setShowTickets(!showTickets)}
          className="w-full flex items-center justify-between py-3 px-4 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors text-sm"
        >
          <span>
            {lowestPrice ? `Get Tickets from $${lowestPrice}` : 'View Tickets'}
          </span>
          <svg
            className={`w-5 h-5 transition-transform duration-200 ${showTickets ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Expanded source list */}
        {showTickets && (
          <div className="mt-2 border border-gray-100 rounded-xl overflow-hidden bg-white shadow-sm">
            <div className="px-4 pt-3 pb-1">
              <p className="text-[11px] text-gray-400 font-medium uppercase tracking-wide">
                Prices include fees where noted
              </p>
            </div>
            <div className="px-3 pb-3 divide-y divide-gray-50">
              {allTicketRows.map(row => (
                <TicketSourceRow
                  key={row.key}
                  favicon={row.favicon}
                  name={row.name}
                  price={row.price}
                  badge={row.badge}
                  url={row.url}
                  isAllin={row.isAllin}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
