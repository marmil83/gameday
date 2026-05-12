'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

interface GameWithRelations {
  id: string;
  home_team_name: string;
  away_team_name: string;
  league: string;
  venue: string;
  start_time: string;
  status: string;
  pipeline_status: string;
  is_featured: boolean;
  is_hidden: boolean;
  affiliate_url: string | null;
  source: string;
  scores: { deal_score: number; reasoning_summary: string }[];
  tags: { tag_name: string; source_type: string }[];
  game_insights: { verdict: string; why_worth_it: string; confidence_score: number }[];
  promotions: {
    id: string;
    promo_type: string;
    promo_item: string;
    promo_description: string;
    confidence_score: number;
    is_ai_extracted: boolean;
    is_admin_verified: boolean;
  }[];
  pricing_snapshots: {
    displayed_price: number;
    pricing_transparency: string;
    source_name: string;
    captured_at: string;
  }[];
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function PipelineBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    enriched: 'bg-blue-100 text-blue-800',
    reviewed: 'bg-green-100 text-green-800',
    published: 'bg-emerald-100 text-emerald-800',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

export default function AdminDashboard() {
  const [games, setGames] = useState<GameWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningPipeline, setRunningPipeline] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<string | null>(null);
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split('T')[0]);
  const router = useRouter();

  const fetchGames = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterDate) params.set('date', filterDate);
      const res = await fetch(`/api/admin/games?${params}`);
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      const data = await res.json();
      setGames(data.games || []);
    } catch {
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [filterDate, router]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  async function runPipeline() {
    setRunningPipeline(true);
    setPipelineResult(null);
    try {
      const res = await fetch('/api/pipeline/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setPipelineResult(JSON.stringify(data, null, 2));
      fetchGames();
    } catch (err) {
      setPipelineResult(`Error: ${err}`);
    } finally {
      setRunningPipeline(false);
    }
  }

  async function updateGame(gameId: string, updates: Record<string, unknown>, reason?: string) {
    await fetch('/api/admin/games', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: gameId, updates, reason }),
    });
    fetchGames();
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-gray-900">WorthGoing Admin</h1>
            <a href="/" className="text-xs text-blue-600 hover:underline">View public site</a>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={runPipeline}
              disabled={runningPipeline}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {runningPipeline ? 'Running Pipeline...' : 'Run Pipeline'}
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Pipeline result */}
        {pipelineResult && (
          <div className="mb-6 p-4 bg-gray-900 rounded-xl text-xs text-green-400 font-mono overflow-x-auto">
            <div className="flex justify-between items-start mb-2">
              <span className="text-gray-500">Pipeline Result</span>
              <button onClick={() => setPipelineResult(null)} className="text-gray-500 hover:text-white">
                dismiss
              </button>
            </div>
            <pre>{pipelineResult}</pre>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <input
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">
            {games.length} game{games.length !== 1 ? 's' : ''} found
          </span>
        </div>

        {/* Games Table */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">Loading...</div>
        ) : games.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-lg">No games found for this date</p>
            <p className="text-gray-400 text-sm mt-1">Try running the pipeline or selecting a different date</p>
          </div>
        ) : (
          <div className="space-y-4">
            {games.map(game => {
              const latestPricing = game.pricing_snapshots
                ?.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())?.[0];
              const score = game.scores?.[0];
              const insight = game.game_insights?.[0];

              return (
                <div key={game.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  {/* Game header row */}
                  <div className="p-4 flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-gray-400 uppercase">{game.league}</span>
                        <PipelineBadge status={game.pipeline_status} />
                        {game.is_featured && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800">Featured</span>
                        )}
                        {game.is_hidden && (
                          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">Hidden</span>
                        )}
                        <span className="text-xs text-gray-400">via {game.source}</span>
                      </div>
                      <h3 className="mt-1 font-semibold text-gray-900">
                        {game.away_team_name} @ {game.home_team_name}
                      </h3>
                      <p className="text-sm text-gray-500">
                        {formatDateTime(game.start_time)} &middot; {game.venue}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 ml-4">
                      {/* Deal Score */}
                      {score && (
                        <div className="text-center">
                          <div className="text-2xl font-bold text-gray-900">{score.deal_score.toFixed(1)}</div>
                          <div className="text-[10px] text-gray-400">Deal Score</div>
                        </div>
                      )}
                      {/* Price */}
                      {latestPricing && (
                        <div className="text-center">
                          <div className="text-xl font-bold text-gray-900">${latestPricing.displayed_price}</div>
                          <div className="text-[10px] text-gray-400">{latestPricing.pricing_transparency}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Details row */}
                  <div className="px-4 pb-3 space-y-2">
                    {/* Promotions */}
                    {game.promotions.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">Promotions</p>
                        {game.promotions.map(promo => (
                          <div key={promo.id} className="flex items-center gap-2 text-sm">
                            <span className={`w-2 h-2 rounded-full ${promo.is_admin_verified ? 'bg-green-500' : promo.is_ai_extracted ? 'bg-yellow-500' : 'bg-gray-300'}`} />
                            <span className="text-gray-700">
                              {promo.promo_type}: {promo.promo_description || promo.promo_item}
                            </span>
                            <span className="text-xs text-gray-400">
                              ({(promo.confidence_score * 100).toFixed(0)}% confident)
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Verdict */}
                    {insight?.verdict && (
                      <p className="text-sm italic text-gray-600">&ldquo;{insight.verdict}&rdquo;</p>
                    )}

                    {/* Tags */}
                    {game.tags.length > 0 && (
                      <div className="flex gap-1">
                        {game.tags.map(tag => (
                          <span key={tag.tag_name} className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700">
                            {tag.tag_name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions bar */}
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 flex items-center gap-2">
                    <button
                      onClick={() => updateGame(game.id, { is_featured: !game.is_featured })}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                        game.is_featured
                          ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {game.is_featured ? 'Unfeature' : 'Feature'}
                    </button>
                    <button
                      onClick={() => updateGame(game.id, { is_hidden: !game.is_hidden })}
                      className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                        game.is_hidden
                          ? 'bg-red-100 text-red-700 hover:bg-red-200'
                          : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {game.is_hidden ? 'Unhide' : 'Hide'}
                    </button>
                    <button
                      onClick={() => updateGame(game.id, { pipeline_status: 'reviewed' })}
                      className="px-3 py-1 text-xs font-medium rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Mark Reviewed
                    </button>
                    <button
                      onClick={() => updateGame(game.id, { pipeline_status: 'published' })}
                      className="px-3 py-1 text-xs font-medium rounded-lg bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                    >
                      Publish
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
