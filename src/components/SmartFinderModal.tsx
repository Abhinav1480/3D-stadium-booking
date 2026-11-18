import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Compass,
  Eye,
  GitCompare,
  Layers,
  MapPin,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useStadiumStore } from '../store/useStadiumStore';
import {
  recommendSeats,
  type RecommendationSortBy,
  type SeatRecommendationGroup,
  type SeatWithInventory,
} from '../shared/stadiumSpec';

const BUDGET_PRESETS = [
  { label: '₹2.5k', value: 2500 },
  { label: '₹4.5k', value: 4500 },
  { label: '₹8k', value: 8000 },
  { label: 'Any', value: 0 },
];

export const SmartFinderModal: React.FC = () => {
  const activeModal = useStadiumStore((s) => s.activeModal);
  const setActiveModal = useStadiumStore((s) => s.setActiveModal);
  const activeMatchId = useStadiumStore((s) => s.activeMatchId);
  const stadiumSpec = useStadiumStore((s) => s.stadiumSpec);
  const seats = useStadiumStore((s) => s.seats);
  const enterSeatView = useStadiumStore((s) => s.enterSeatView);
  const setSelectedSeatIds = useStadiumStore((s) => s.setSelectedSeatIds);
  const showToast = useStadiumStore((s) => s.showToast);

  const [budgetInr, setBudgetInr] = useState<number>(6000);
  const [groupSize, setGroupSize] = useState<number>(2);
  const [preferredStandCode, setPreferredStandCode] = useState<string>('ALL');
  const [preferredCategoryCode, setPreferredCategoryCode] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<RecommendationSortBy>('MATCH_SCORE');
  const [requireAdjacentSeats, setRequireAdjacentSeats] = useState<boolean>(true);

  const [preferBestView, setPreferBestView] = useState<boolean>(true);
  const [preferStraightView, setPreferStraightView] = useState<boolean>(true);
  const [preferShade, setPreferShade] = useState<boolean>(true);
  const [preferCloseToPitch, setPreferCloseToPitch] = useState<boolean>(false);
  const [preferBestElevation, setPreferBestElevation] = useState<boolean>(false);
  const [preferNearEntrance, setPreferNearEntrance] = useState<boolean>(false);
  const [preferFamilyZone, setPreferFamilyZone] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(false);
  const [results, setResults] = useState<SeatRecommendationGroup[]>([]);
  const [compareGroups, setCompareGroups] = useState<SeatRecommendationGroup[]>([]);
  const [showCompareDrawer, setShowCompareDrawer] = useState<boolean>(false);

  const fetchRecommendations = useCallback(async () => {
    setLoading(true);
    const prefs = {
      budgetPerSeatPaise: budgetInr > 0 ? budgetInr * 100 : 0,
      groupSize,
      preferredStandCode,
      preferredCategoryCode,
      preferBestView,
      preferShade,
      preferStraightView,
      preferCloseToPitch,
      preferBestElevation,
      preferNearEntrance,
      preferFamilyZone,
      requireAdjacentSeats,
      sortBy,
    };

    const computeLocal = () => {
      const storeNow = useStadiumStore.getState();
      const invMap = storeNow.inventoryBySeatId;
      const priceMap = storeNow.priceByCategoryId;
      const enriched: SeatWithInventory[] = storeNow.seats.map((s) => ({
        ...s,
        standCode: s.standCode as any,
        categoryCode: s.categoryCode as any,
        status: invMap[s.id]?.status || 'AVAILABLE',
        pricePaise: priceMap[s.categoryId] ?? 180000,
      }));
      setResults(recommendSeats(enriched, prefs, 8));
    };

    try {
      const res = await fetch(`/api/matches/${activeMatchId}/recommendations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.toLowerCase().includes('application/json')) {
        computeLocal();
        return;
      }
      const data = await res.json();
      if (data.recommendations) {
        setResults(data.recommendations);
      } else {
        computeLocal();
      }
    } catch {
      computeLocal();
    } finally {
      setLoading(false);
    }
  }, [
    activeMatchId,
    budgetInr,
    groupSize,
    preferredStandCode,
    preferredCategoryCode,
    preferBestView,
    preferShade,
    preferStraightView,
    preferCloseToPitch,
    preferBestElevation,
    preferNearEntrance,
    preferFamilyZone,
    requireAdjacentSeats,
    sortBy,
  ]);

  useEffect(() => {
    if (activeModal === 'SMART_FINDER') {
      fetchRecommendations();
    }
  }, [activeModal, fetchRecommendations]);

  if (activeModal !== 'SMART_FINDER') return null;

  const handleResetFilters = () => {
    setBudgetInr(0);
    setGroupSize(2);
    setPreferredStandCode('ALL');
    setPreferredCategoryCode('ALL');
    setSortBy('MATCH_SCORE');
    setRequireAdjacentSeats(true);
    setPreferBestView(true);
    setPreferStraightView(true);
    setPreferShade(true);
    setPreferCloseToPitch(false);
    setPreferBestElevation(false);
    setPreferNearEntrance(false);
    setPreferFamilyZone(false);
  };

  const toggleCompare = (rec: SeatRecommendationGroup) => {
    setCompareGroups((prev) => {
      const exists = prev.some((g) => g.groupId === rec.groupId);
      if (exists) return prev.filter((g) => g.groupId !== rec.groupId);
      if (prev.length >= 3) {
        showToast('Comparing up to 3 seat groups side-by-side', 'info');
        return [...prev.slice(1), rec];
      }
      return [...prev, rec];
    });
  };

  const locateGroupIn3D = (rec: SeatRecommendationGroup) => {
    const targetSeat = seats.find((s) => s.id === rec.seatIds[0]);
    if (!targetSeat) {
      showToast('Could not locate seat anchor in 3D bowl', 'error');
      return;
    }
    setSelectedSeatIds(rec.seatIds);
    enterSeatView(targetSeat);
    setActiveModal('NONE');
    showToast(
      `Flying into 3D Seat View for ${rec.seatCodes.join(', ')} (${rec.standName})`,
      'info'
    );
  };

  const preferenceToggles = [
    {
      id: 'pref-best-view',
      label: 'Best Overall Sightline Score',
      checked: preferBestView,
      set: setPreferBestView,
    },
    {
      id: 'pref-straight',
      label: 'Straight Bowler / Batter Arm Axis',
      checked: preferStraightView,
      set: setPreferStraightView,
    },
    {
      id: 'pref-shade',
      label: 'Maximum Afternoon Canopy Shade',
      checked: preferShade,
      set: setPreferShade,
    },
    {
      id: 'pref-close',
      label: 'Closest to Boundary & Pitch',
      checked: preferCloseToPitch,
      set: setPreferCloseToPitch,
    },
    {
      id: 'pref-elevation',
      label: 'Optimal Elevated Viewing Rake',
      checked: preferBestElevation,
      set: setPreferBestElevation,
    },
    {
      id: 'pref-entrance',
      label: 'Near Concourse & Aisle Entrances',
      checked: preferNearEntrance,
      set: setPreferNearEntrance,
    },
    {
      id: 'pref-family',
      label: 'Family-Friendly Stand Zones',
      checked: preferFamilyZone,
      set: setPreferFamilyZone,
    },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="smart-finder-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5"
    >
      <div className="w-full max-w-6xl rounded-xl bg-[#0B0F17] border border-white/10 text-slate-100 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#0F172A] border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center">
              <Compass className="w-5 h-5 text-sky-400" />
            </div>
            <div>
              <h2 id="smart-finder-title" className="text-base sm:text-lg font-bold text-white">
                Smart Seat Discovery Engine
              </h2>
              <p className="text-xs text-slate-400">
                Real-time geometric sightline, sun-shade, elevation & budget optimization across 4,800 seats
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {compareGroups.length > 0 && (
              <button
                type="button"
                onClick={() => setShowCompareDrawer((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-xs font-semibold text-sky-300 transition-colors"
              >
                <GitCompare className="w-3.5 h-3.5" />
                Compare ({compareGroups.length}/3)
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveModal('NONE')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-medium text-slate-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
        </div>

        {/* Workspace Grid */}
        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          {/* Left Filter Rail */}
          <aside className="lg:col-span-4 bg-[#0F172A]/70 border-b lg:border-b-0 lg:border-r border-white/10 p-5 overflow-y-auto space-y-5">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
                <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
                Discovery Filters
              </span>
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            </div>

            {/* Budget Slider + Presets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label htmlFor="finder-budget" className="font-medium text-slate-300">
                  Max Budget / Seat
                </label>
                <span className="font-mono font-bold text-emerald-400 tabular-nums">
                  {budgetInr > 0 ? `₹${budgetInr.toLocaleString('en-IN')}` : 'Unlimited'}
                </span>
              </div>
              <input
                id="finder-budget"
                type="range"
                min={1000}
                max={15000}
                step={500}
                value={budgetInr > 0 ? budgetInr : 15000}
                onChange={(e) => setBudgetInr(Number(e.target.value))}
                className="w-full accent-emerald-500"
              />
              <div className="grid grid-cols-4 gap-1.5">
                {BUDGET_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setBudgetInr(preset.value)}
                    className={`py-1 rounded text-[11px] font-mono border transition-colors ${
                      budgetInr === preset.value
                        ? 'bg-emerald-600/25 border-emerald-500/60 text-emerald-300 font-semibold'
                        : 'bg-[#0B0F17] border-white/10 text-slate-400 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Group Size & Adjacency */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="finder-group-size"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Tickets
                </label>
                <select
                  id="finder-group-size"
                  value={groupSize}
                  onChange={(e) => setGroupSize(Number(e.target.value))}
                  className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'Seat' : 'Seats'}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="finder-sort"
                  className="block text-xs font-medium text-slate-300 mb-1.5"
                >
                  Sort Results
                </label>
                <select
                  id="finder-sort"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as RecommendationSortBy)}
                  className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="MATCH_SCORE">Best Match Score</option>
                  <option value="PRICE_ASC">Lowest Price First</option>
                  <option value="VIEW_SCORE">Highest View Score</option>
                  <option value="CLOSEST_PITCH">Closest to Pitch</option>
                  <option value="SHADE">Most Afternoon Shade</option>
                </select>
              </div>
            </div>

            <label className="flex items-center justify-between rounded-lg bg-[#0B0F17] border border-white/10 px-3 py-2.5 cursor-pointer">
              <span className="flex items-center gap-2 text-xs text-slate-200">
                <Users className="w-3.5 h-3.5 text-sky-400" />
                Seat group adjacent together
              </span>
              <input
                type="checkbox"
                checked={requireAdjacentSeats}
                onChange={(e) => setRequireAdjacentSeats(e.target.checked)}
                className="accent-emerald-500"
              />
            </label>

            {/* Stand & Category Dropdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
              <div>
                <label
                  htmlFor="finder-stand"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Stand Preference
                </label>
                <select
                  id="finder-stand"
                  value={preferredStandCode}
                  onChange={(e) => setPreferredStandCode(e.target.value)}
                  className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All 8 Stadium Stands</option>
                  {(stadiumSpec?.stands || []).map((st) => (
                    <option key={st.code} value={st.code}>
                      {st.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="finder-category"
                  className="block text-xs font-medium text-slate-300 mb-1"
                >
                  Seating Tier / Category
                </label>
                <select
                  id="finder-category"
                  value={preferredCategoryCode}
                  onChange={(e) => setPreferredCategoryCode(e.target.value)}
                  className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="ALL">All Seating Categories</option>
                  {(stadiumSpec?.categories || []).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Experience Weight Toggles */}
            <div className="space-y-2 pt-2 border-t border-white/10">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Experience Priorities
              </div>
              <div className="space-y-1.5">
                {preferenceToggles.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center gap-2.5 text-xs text-slate-300 hover:text-white cursor-pointer py-1"
                  >
                    <input
                      id={item.id}
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => item.set(e.target.checked)}
                      className="accent-emerald-500 rounded"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>

          {/* Right Ranked Results */}
          <div className="lg:col-span-8 p-5 overflow-y-auto space-y-4">
            {/* Side-by-Side Comparison Drawer */}
            {showCompareDrawer && compareGroups.length > 0 && (
              <div className="rounded-xl bg-[#0F172A] border border-sky-500/40 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
                    <GitCompare className="w-4 h-4" />
                    Side-by-Side Group Comparison ({compareGroups.length})
                  </div>
                  <button
                    type="button"
                    onClick={() => setCompareGroups([])}
                    className="text-[11px] text-slate-400 hover:text-white"
                  >
                    Clear All
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {compareGroups.map((g) => (
                    <div
                      key={g.groupId}
                      className="rounded-lg bg-[#0B0F17] border border-white/10 p-3 space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-white truncate">{g.standName}</div>
                        <button
                          type="button"
                          onClick={() => toggleCompare(g)}
                          className="text-slate-400 hover:text-rose-400"
                          aria-label={`Remove ${g.groupId} from comparison`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="font-mono text-[11px] text-sky-400 truncate">
                        {g.seatCodes.join(', ')}
                      </div>
                      <div className="grid grid-cols-2 gap-y-1 text-[11px] font-mono tabular-nums pt-1 border-t border-white/10">
                        <span className="text-slate-400">Per Seat:</span>
                        <span className="text-right text-white font-semibold">
                          ₹{(g.pricePerSeatPaise / 100).toLocaleString('en-IN')}
                        </span>
                        <span className="text-slate-400">View Score:</span>
                        <span className="text-right text-emerald-400 font-semibold">
                          {g.averageViewScore}/100
                        </span>
                        <span className="text-slate-400">Pitch Dist:</span>
                        <span className="text-right text-slate-200">{g.distanceToPitchM}m</span>
                        <span className="text-slate-400">Elevation:</span>
                        <span className="text-right text-slate-200">{g.elevationAngleDeg}°</span>
                        <span className="text-slate-400">Roof Shade:</span>
                        <span className="text-right text-slate-200">{g.averageShadePct}%</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => locateGroupIn3D(g)}
                        className="w-full py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold"
                      >
                        Locate in 3D
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Results Header */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-400">
                {loading
                  ? 'Scoring seating bowl geometry & live inventory...'
                  : `Showing top ${results.length} verified seat groups (${groupSize} ${
                      groupSize === 1 ? 'seat' : 'seats'
                    })`}
              </div>
              <button
                type="button"
                onClick={fetchRecommendations}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
              >
                {loading ? 'Refreshing...' : 'Re-Run Finder'}
              </button>
            </div>

            {/* Loading Skeletons */}
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((n) => (
                  <div
                    key={n}
                    className="h-32 rounded-xl bg-[#0F172A] border border-white/10 animate-pulse"
                  />
                ))}
              </div>
            ) : results.length === 0 ? (
              <div className="rounded-xl bg-[#0F172A] border border-white/10 p-10 text-center space-y-3">
                <Sparkles className="w-8 h-8 text-slate-500 mx-auto" />
                <div className="text-sm font-semibold text-white">
                  No matching seat groups found under current constraints
                </div>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Try increasing your budget per seat, switching Stand/Category to All, or unchecking "Seat group adjacent together".
                </p>
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {results.map((rec, idx) => {
                  const isPinned = compareGroups.some((g) => g.groupId === rec.groupId);
                  return (
                    <div
                      key={rec.groupId}
                      data-testid={`finder-result-card-${idx}`}
                      className="rounded-xl bg-[#0F172A] border border-white/10 hover:border-emerald-500/40 p-4 transition-colors space-y-3"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono font-bold text-emerald-400">
                              #{idx + 1} · {rec.matchScore} pts
                            </span>
                            <span className="text-slate-600">·</span>
                            <span className="font-semibold text-white">{rec.standName}</span>
                            <span className="text-slate-600">·</span>
                            <span className="text-slate-300">
                              {rec.blockName} (Tier {rec.tier})
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono font-semibold text-sky-400">
                              {rec.seatCodes.join(', ')}
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-300">{rec.categoryName}</span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-400">Row {rec.rowNumber}</span>
                          </div>
                        </div>

                        <div className="text-left sm:text-right font-mono tabular-nums shrink-0">
                          <div className="text-base font-bold text-white">
                            ₹{(rec.totalPricePaise / 100).toLocaleString('en-IN')}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            ₹{(rec.pricePerSeatPaise / 100).toLocaleString('en-IN')} / seat
                          </div>
                        </div>
                      </div>

                      {/* Telemetry Strip */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg bg-[#0B0F17] border border-white/10 p-2.5 text-xs font-mono tabular-nums">
                        <div className="flex items-center gap-2">
                          <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <div>
                            <div className="text-[10px] font-sans text-slate-400">View Score</div>
                            <div className="font-bold text-white">{rec.averageViewScore}/100</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <div>
                            <div className="text-[10px] font-sans text-slate-400">Pitch Distance</div>
                            <div className="font-bold text-white">
                              {rec.distanceToPitchM}m ({rec.elevationAngleDeg}°)
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <div>
                            <div className="text-[10px] font-sans text-slate-400">Roof Shade</div>
                            <div className="font-bold text-white">{rec.averageShadePct}%</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <div>
                            <div className="text-[10px] font-sans text-slate-400">Block Open</div>
                            <div className="font-bold text-white">
                              {rec.availableInBlockCount} seats
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Explanation & Action Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                        <p className="text-xs text-slate-400 leading-relaxed">{rec.explanation}</p>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              toggleCompare(rec);
                              if (!isPinned) setShowCompareDrawer(true);
                            }}
                            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
                              isPinned
                                ? 'bg-sky-600/20 border-sky-500/50 text-sky-300'
                                : 'bg-slate-800 hover:bg-slate-700 border-white/10 text-slate-300'
                            }`}
                          >
                            {isPinned ? (
                              <Check className="w-3.5 h-3.5" />
                            ) : (
                              <GitCompare className="w-3.5 h-3.5" />
                            )}
                            {isPinned ? 'Pinned' : 'Compare'}
                          </button>

                          <button
                            type="button"
                            onClick={() => locateGroupIn3D(rec)}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            Locate in 3D Stadium
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
