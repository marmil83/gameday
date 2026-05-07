'use client';

import { useState } from 'react';
import type { GameCard as GameCardType, PricingSnapshot } from '@/types/database';
import { PRICING_LABELS } from '@/lib/constants';

interface StaticSource {
  name: string;
  favicon: string;
  label?: string;
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
      className="flex items-center gap-3 py-3 px-1 rounded-xl transition-colors group"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      <img
        src={favicon}
        alt={name}
        className="w-5 h-5 rounded object-contain shrink-0"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <span className="text-sm font-medium" style={{ color: '#1d1d1f' }}>{name}</span>
        {badge && (
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: '#F2F2F7', color: '#86868b' }}>
            {badge}
          </span>
        )}
        {isAllin && (
          <span className="text-[10px] font-medium" style={{ color: '#34c759' }}>all-in</span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {price != null ? (
          <span className="text-sm font-semibold" style={{ color: '#1d1d1f' }}>from ${price}</span>
        ) : (
          <span className="text-sm font-medium" style={{ color: '#0071e3' }}>Visit site</span>
        )}
        <svg className="w-3.5 h-3.5 ml-0.5" style={{ color: '#aeaeb2' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </a>
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

  const dbSourceNames = new Set(all_pricing.map(s => s.source_name));

  const pricedRows = all_pricing
    .filter(s => s.lowest_price != null)
    .sort((a, b) => (a.lowest_price ?? 999) - (b.lowest_price ?? 999))
    .map(s => {
      const meta = SOURCE_DISPLAY[s.source_name] ?? { label: s.source_name, favicon: '', isAllin: false };
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
                <span className="text-3xl font-bold tracking-tight" style={{ color: '#1d1d1f' }}>
                  ${lowestPrice}
                </span>
                <span className="text-xs" style={{ color: '#86868b' }}>
                  from · {getPricingLabel(pricing)}
                </span>
              </div>
              {insights?.price_insight && (
                <p className="text-xs mt-1" style={{ color: '#86868b' }}>{insights.price_insight}</p>
              )}
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

      {/* Promo */}
      {topPromo && (
        <div className="mx-6 mb-4 px-4 py-3 rounded-2xl" style={{ background: '#FFF9EC', border: '1px solid rgba(255,149,0,0.15)' }}>
          <p className="text-xs font-medium" style={{ color: '#bf6900' }}>
            {topPromo.promo_type === 'giveaway' ? '🎁 ' : '⭐ '}
            {insights?.promo_clarity || topPromo.promo_description || topPromo.promo_item}
          </p>
        </div>
      )}

      {/* Verdict */}
      {insights?.verdict && (
        <div className="px-6 pb-3">
          <p className="text-sm font-semibold leading-snug" style={{ color: '#1d1d1f', fontStyle: 'italic' }}>
            &ldquo;{insights.verdict}&rdquo;
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
            <div className="px-4 pt-3 pb-1">
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#aeaeb2' }}>
                Compare prices
              </p>
            </div>
            <div className="px-3 pb-3 divide-y" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
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
