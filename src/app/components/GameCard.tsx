'use client';

import { useState } from 'react';
import type { GameCard as GameCardType } from '@/types/database';
import { PRICING_LABELS } from '@/lib/constants';

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

export default function GameCard({ data, timezone }: { data: GameCardType; timezone?: string }) {
  const { game, pricing, promotions, score, tags, insights, home_team_logo, away_team_logo } = data;
  const dealScore = Number(score?.deal_score) || 0;
  const topPromo = promotions?.[0];
  const lowestPrice = pricing ? Number(pricing.lowest_price || pricing.displayed_price) : null;
  const [showBreakdown, setShowBreakdown] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-shadow">
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
                {game.away_team_name}
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

      {/* CTA */}
      <div className="px-5 pb-5">
        <a
          href={game.affiliate_url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="block w-full text-center py-3 px-4 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors text-sm"
        >
          {lowestPrice
            ? `Get Tickets from $${lowestPrice}`
            : 'View Tickets'}
        </a>
      </div>
    </div>
  );
}
