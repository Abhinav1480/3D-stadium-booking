import React, { useEffect, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  Info,
  Layers,
  Map as MapIcon,
  Moon,
  Navigation,
  Play,
  RotateCcw,
  Sliders,
  SlidersHorizontal,
  Sun,
  Sunset,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useStadiumStore, type QualityPreset, type RoofMode } from '../store/useStadiumStore';
import { DEFAULT_STADIUM_SPEC } from '../shared/stadiumSpec';
import { soundEngine } from '../utils/soundEngine';
import { recordReactRender } from '../utils/perfProfiler';

function formatSunClock(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
}

export const BottomControlDock: React.FC<{
  onHoldSelectedSeats: () => Promise<void>;
  holdingSeats: boolean;
}> = React.memo(({ onHoldSelectedSeats, holdingSeats }) => {
  recordReactRender('BottomControlDock');
  const matches = useStadiumStore((s) => s.matches);
  const activeMatchId = useStadiumStore((s) => s.activeMatchId);
  const setActiveMatchId = useStadiumStore((s) => s.setActiveMatchId);
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const setCameraMode = useStadiumStore((s) => s.setCameraMode);
  const resetCamera = useStadiumStore((s) => s.resetCamera);
  const freeFlySpeedMps = useStadiumStore((s) => s.freeFlySpeedMps);
  const setFreeFlySpeedMps = useStadiumStore((s) => s.setFreeFlySpeedMps);
  const roofMode = useStadiumStore((s) => s.roofMode);
  const setRoofMode = useStadiumStore((s) => s.setRoofMode);
  const activeStandCode = useStadiumStore((s) => s.activeStandCode);
  const activeBlockCode = useStadiumStore((s) => s.activeBlockCode);
  const focusStand = useStadiumStore((s) => s.focusStand);
  const timeOfDayHours = useStadiumStore((s) => s.timeOfDayHours);
  const setTimeOfDayHours = useStadiumStore((s) => s.setTimeOfDayHours);
  const qualityPreset = useStadiumStore((s) => s.qualityPreset);
  const setQualityPreset = useStadiumStore((s) => s.setQualityPreset);
  const is2DFallback = useStadiumStore((s) => s.is2DFallback);
  const setIs2DFallback = useStadiumStore((s) => s.setIs2DFallback);
  const isHudCollapsed = useStadiumStore((s) => s.isHudCollapsed);
  const setIsHudCollapsed = useStadiumStore((s) => s.setIsHudCollapsed);
  const crowdAudioEnabled = useStadiumStore((s) => s.crowdAudioEnabled);
  const setCrowdAudioEnabled = useStadiumStore((s) => s.setCrowdAudioEnabled);
  const filterCategoryCode = useStadiumStore((s) => s.filterCategoryCode);
  const setFilterCategoryCode = useStadiumStore((s) => s.setFilterCategoryCode);
  const filterCoveredOnly = useStadiumStore((s) => s.filterCoveredOnly);
  const setFilterCoveredOnly = useStadiumStore((s) => s.setFilterCoveredOnly);
  const selectedSeatIds = useStadiumStore((s) => s.selectedSeatIds);
  const toggleSeatSelection = useStadiumStore((s) => s.toggleSeatSelection);
  const clearSelectedSeats = useStadiumStore((s) => s.clearSelectedSeats);
  const seatVisualMode = useStadiumStore((s) => s.seatVisualMode);
  const setSeatVisualMode = useStadiumStore((s) => s.setSeatVisualMode);
  const seats = useStadiumStore((s) => s.seats);
  const priceByCategoryId = useStadiumStore((s) => s.priceByCategoryId);
  const activeHotspot = useStadiumStore((s) => s.activeHotspot);
  const setActiveHotspot = useStadiumStore((s) => s.setActiveHotspot);
  const enterSeatView = useStadiumStore((s) => s.enterSeatView);

  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  // Close Advanced drawer when the dock collapses
  useEffect(() => {
    if (isHudCollapsed && advancedOpen) {
      setAdvancedOpen(false);
    }
  }, [isHudCollapsed, advancedOpen]);

  // Independent keyboard shortcut 'H' to toggle Stadium Controls (Cinema Mode)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) ||
          active.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'KeyH' || e.key === 'h' || e.key === 'H') {
        const st = useStadiumStore.getState();
        if (st.activeModal !== 'NONE') return;
        st.setIsHudCollapsed(!st.isHudCollapsed);
      }
      if (e.key === 'Escape' && advancedOpen) {
        setAdvancedOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advancedOpen]);

  const selectedSeatsList = seats.filter((s) => selectedSeatIds.includes(s.id));
  const selectedTotalPaise = selectedSeatsList.reduce(
    (sum, s) => sum + (priceByCategoryId[s.categoryId] ?? 180000),
    0
  );
  const activeStandObj = DEFAULT_STADIUM_SPEC.stands.find(
    (st) => st.code === activeStandCode
  );
  const hasActiveFilters =
    filterCategoryCode !== 'ALL' ||
    filterCoveredOnly ||
    seatVisualMode === 'AVAILABILITY' ||
    Boolean(activeStandCode);

  return (
    <div className="fixed bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-20 w-auto max-w-[96vw] flex flex-col items-center pointer-events-none">
      {/* Collapsed Discreet Floating Toggle ("Controls (H)") */}
      {isHudCollapsed && (
        <button
          type="button"
          data-testid="controls-open-toggle"
          onClick={() => setIsHudCollapsed(false)}
          aria-expanded={false}
          aria-controls="stadium-controls-panel"
          className="pointer-events-auto inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#0B0F17]/90 hover:bg-[#0F172A] backdrop-blur-md border border-white/15 text-xs font-medium text-slate-200 hover:text-white shadow-xl transition-all duration-200"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
          <span>Controls</span>
          <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 font-mono text-[10px] text-slate-400">
            H
          </kbd>
        </button>
      )}

      {/* Expanded Compact Floating Dock + Advanced Controls Drawer */}
      <div
        id="stadium-controls-panel"
        aria-hidden={isHudCollapsed}
        inert={isHudCollapsed}
        className={`w-full flex flex-col items-center transition-all duration-200 ease-out origin-bottom ${
          isHudCollapsed
            ? 'max-h-0 opacity-0 invisible translate-y-3 pointer-events-none overflow-hidden'
            : 'opacity-100 visible translate-y-0 pointer-events-none'
        }`}
      >
        {/* Expandable Advanced Controls Panel / Mobile Bottom Sheet */}
        {advancedOpen && !isHudCollapsed && (
          <div
            role="region"
            aria-label="Advanced Stadium Controls"
            data-testid="advanced-controls-panel"
            className="pointer-events-auto mb-2 w-[min(780px,94vw)] max-h-[54vh] sm:max-h-[520px] overflow-y-auto rounded-2xl bg-[#0B0F17]/95 backdrop-blur-xl border border-white/15 p-3 sm:p-3.5 text-slate-100 shadow-2xl space-y-2.5"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
              <div className="flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-semibold tracking-tight text-white">
                  Advanced Stadium Controls
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAdvancedOpen(false)}
                aria-label="Close Advanced Controls"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-[11px] text-slate-300"
              >
                <X className="w-3 h-3" />
                Done
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
              {/* Group 1: Match & Stadium Stand Focus */}
              <div className="md:col-span-2 rounded-xl bg-[#0F172A]/80 border border-white/10 p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Match & Stadium Stands
                  </span>
                  <div className="flex items-center gap-2 flex-1 sm:flex-initial justify-end">
                    <label htmlFor="dock-match-select" className="text-[11px] text-slate-400 sr-only">
                      Match Fixture
                    </label>
                    <select
                      id="dock-match-select"
                      value={activeMatchId}
                      onChange={(e) => setActiveMatchId(Number(e.target.value))}
                      className="rounded-lg bg-[#0B0F17] border border-white/15 px-2.5 py-1 text-xs font-medium text-white max-w-[280px] w-full sm:w-auto truncate focus:outline-none focus:border-emerald-500"
                    >
                      {matches.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title} ({m.inventorySummary.occupancyPct}% Booked)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Horizontal-scrollable on mobile, clean wrap on desktop */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
                  <button
                    type="button"
                    onClick={() => focusStand(null, null)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 border ${
                      !activeStandCode
                        ? 'bg-emerald-600/20 border-emerald-500/60 text-emerald-300'
                        : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    Full Bowl
                  </button>
                  {DEFAULT_STADIUM_SPEC.stands.map((st) => (
                    <button
                      key={st.code}
                      type="button"
                      onClick={() => focusStand(st.code, null)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap shrink-0 border ${
                        activeStandCode === st.code
                          ? 'bg-emerald-600/20 border-emerald-500/60 text-emerald-300'
                          : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:text-white'
                      }`}
                    >
                      {st.shortName.replace(' Stand', '').replace(' Pavilion', '')}
                    </button>
                  ))}
                </div>

                {activeStandObj && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-white/10">
                    <span className="text-[11px] text-slate-400 mr-1">Tier Block:</span>
                    {activeStandObj.blocks.map((bl) => (
                      <button
                        key={bl.code}
                        type="button"
                        onClick={() => focusStand(activeStandObj.code, bl.code)}
                        className={`px-2 py-0.5 rounded font-mono text-[11px] transition-colors border ${
                          activeBlockCode === bl.code
                            ? 'bg-sky-600/25 border-sky-400 text-sky-300'
                            : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:text-white'
                        }`}
                      >
                        T{bl.tier} ({bl.code})
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Group 2: Seat Filters */}
              <div className="rounded-xl bg-[#0F172A]/80 border border-white/10 p-2.5 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Seat Filters & Visualization
                </div>
                <div className="space-y-1.5">
                  <select
                    aria-label="Filter by Seat Category"
                    value={filterCategoryCode}
                    onChange={(e) => setFilterCategoryCode(e.target.value)}
                    className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="ALL">All Seating Categories</option>
                    {DEFAULT_STADIUM_SPEC.categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFilterCoveredOnly(!filterCoveredOnly)}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                        filterCoveredOnly
                          ? 'bg-sky-500/20 border-sky-400/60 text-sky-300'
                          : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:text-white'
                      }`}
                    >
                      Roof Shade Only
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setSeatVisualMode(
                          seatVisualMode === 'REALISTIC' ? 'AVAILABILITY' : 'REALISTIC'
                        )
                      }
                      aria-pressed={seatVisualMode === 'AVAILABILITY'}
                      className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                        seatVisualMode === 'AVAILABILITY'
                          ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                          : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:text-white'
                      }`}
                    >
                      {seatVisualMode === 'AVAILABILITY'
                        ? 'Seats: Availability'
                        : 'Seats: Realistic'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Group 3: Venue Facilities & Stadium Information */}
              <div className="rounded-xl bg-[#0F172A]/80 border border-white/10 p-2.5 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Venue & Stadium Info
                </div>
                <select
                  aria-label="Inspect Stadium Facility Hotspot"
                  value={activeHotspot?.id ?? ''}
                  onChange={(e) => {
                    const hs = DEFAULT_STADIUM_SPEC.hotspots.find(
                      (h) => h.id === e.target.value
                    );
                    setActiveHotspot(hs || null);
                  }}
                  className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="">Venue Facilities (Inspect Landmark)</option>
                  {DEFAULT_STADIUM_SPEC.hotspots.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
                </select>
                <div className="flex items-start gap-2 rounded-lg bg-[#0B0F17] border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-400">
                  <Info className="w-3.5 h-3.5 text-sky-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    {activeHotspot ? (
                      <>
                        <div className="font-semibold text-white truncate">
                          {activeHotspot.label}
                        </div>
                        <div className="line-clamp-2 text-slate-400">
                          {activeHotspot.description}
                        </div>
                      </>
                    ) : (
                      <span>
                        <strong className="text-slate-200">{DEFAULT_STADIUM_SPEC.name}</strong> ·{' '}
                        {DEFAULT_STADIUM_SPEC.city} · 8 Stands · 3 Tiers · 4,800 Indexed Seats
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Group 4: Environment (Audio & Graphics Quality) */}
              <div className="rounded-xl bg-[#0F172A]/80 border border-white/10 p-2.5 space-y-2">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Environment & Graphics
                </div>
                <div className="flex sm:hidden items-center justify-between gap-2 pb-1 border-b border-white/10">
                  <span className="text-[11px] text-slate-300">
                    Sun Time ({formatSunClock(timeOfDayHours)})
                  </span>
                  <input
                    type="range"
                    aria-label="Mobile Time of Day Solar Slider"
                    min={9}
                    max={21.5}
                    step={0.25}
                    value={timeOfDayHours}
                    onChange={(e) => setTimeOfDayHours(Number(e.target.value))}
                    className="w-32 accent-emerald-500"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const next = !crowdAudioEnabled;
                      setCrowdAudioEnabled(next);
                      soundEngine.toggleCrowdMurmur(next);
                    }}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                      crowdAudioEnabled
                        ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                        : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:text-white'
                    }`}
                  >
                    {crowdAudioEnabled ? (
                      <Volume2 className="w-3.5 h-3.5" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5" />
                    )}
                    {crowdAudioEnabled ? 'Audio: On' : 'Audio: Muted'}
                  </button>

                  <div className="flex items-center gap-1 bg-[#0B0F17] p-0.5 rounded-lg border border-white/10">
                    {(['LOW', 'MEDIUM', 'HIGH', 'ULTRA'] as QualityPreset[]).map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setQualityPreset(q)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium transition-colors ${
                          qualityPreset === q
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {q === 'MEDIUM' ? 'MED' : q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Group 5: Camera & Navigation Settings */}
              <div className="rounded-xl bg-[#0F172A]/80 border border-white/10 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Camera & Cinema Settings
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsHudCollapsed(true)}
                    className="text-[11px] text-sky-400 hover:underline"
                  >
                    Cinema Mode (H)
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor="fly-speed-range"
                    className="text-[11px] text-slate-300 whitespace-nowrap"
                  >
                    Free-Fly Speed ({freeFlySpeedMps} m/s)
                  </label>
                  <input
                    id="fly-speed-range"
                    type="range"
                    min={8}
                    max={100}
                    step={2}
                    value={freeFlySpeedMps}
                    onChange={(e) => setFreeFlySpeedMps(Number(e.target.value))}
                    className="flex-1 accent-sky-500"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                  <span>H: Controls · I: Inspector</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIs2DFallback(false);
                        setCameraMode(cameraMode === 'TOUR' ? 'ORBIT' : 'TOUR');
                        setAdvancedOpen(false);
                      }}
                      className="text-emerald-400 hover:underline"
                    >
                      {cameraMode === 'TOUR' ? 'Stop Tour' : 'Guided Tour'}
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      onClick={() => {
                        resetCamera();
                        setAdvancedOpen(false);
                      }}
                      className="text-slate-200 hover:underline"
                    >
                      Reset Camera
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Free-Fly Contextual Micro-Bar */}
        {!is2DFallback && cameraMode === 'FREE_FLY' && !isHudCollapsed && (
          <div className="pointer-events-auto mb-1.5 flex items-center gap-2 rounded-full bg-[#0B0F17]/90 backdrop-blur-md border border-sky-500/35 px-3 py-1 text-[11px] font-mono text-sky-200 shadow-lg">
            <span className="hidden sm:inline">
              Drag: Look · WASD / Q-E: Fly · Scroll: {freeFlySpeedMps} m/s
            </span>
            <div className="flex sm:hidden items-center gap-1">
              {[
                { label: 'W', code: 'KeyW' },
                { label: 'S', code: 'KeyS' },
                { label: 'A', code: 'KeyA' },
                { label: 'D', code: 'KeyD' },
                { label: 'Up', code: 'KeyE' },
                { label: 'Dn', code: 'KeyQ' },
              ].map((k) => (
                <button
                  key={k.code}
                  type="button"
                  onPointerDown={() =>
                    window.dispatchEvent(new KeyboardEvent('keydown', { code: k.code }))
                  }
                  onPointerUp={() =>
                    window.dispatchEvent(new KeyboardEvent('keyup', { code: k.code }))
                  }
                  onPointerLeave={() =>
                    window.dispatchEvent(new KeyboardEvent('keyup', { code: k.code }))
                  }
                  onPointerCancel={() =>
                    window.dispatchEvent(new KeyboardEvent('keyup', { code: k.code }))
                  }
                  className="px-2 py-0.5 rounded bg-sky-800/80 text-white active:bg-sky-600"
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Compact Selected Seats Cart Strip (shown only when seats are selected & dock is open) */}
        {selectedSeatsList.length > 0 && !isHudCollapsed && (
          <div className="pointer-events-auto mb-1.5 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#0B0F17]/92 backdrop-blur-md border border-emerald-500/40 px-3 py-1.5 text-xs shadow-xl max-w-full">
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <span className="font-semibold text-emerald-300 shrink-0">
                {selectedSeatsList.length}/6 Selected
              </span>
              {selectedSeatsList.map((seatItem) => (
                <span
                  key={seatItem.id}
                  className="inline-flex items-center gap-1 rounded bg-[#0F172A] border border-cyan-500/35 px-1.5 py-0.5 font-mono text-[10px] text-white shrink-0"
                >
                  {seatItem.seatCode}
                  <button
                    type="button"
                    onClick={() => toggleSeatSelection(seatItem.id)}
                    aria-label={`Remove seat ${seatItem.seatCode}`}
                    className="text-slate-400 hover:text-rose-400 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
              <span className="font-mono font-bold text-emerald-400 tabular-nums shrink-0 ml-1">
                ₹{(selectedTotalPaise / 100).toLocaleString('en-IN')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => enterSeatView(selectedSeatsList[0])}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-sky-600/90 hover:bg-sky-500 text-white text-[11px] font-medium"
              >
                <Eye className="w-3 h-3" />
                3D View
              </button>
              <button
                type="button"
                onClick={clearSelectedSeats}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px]"
              >
                Clear
              </button>
              <button
                type="button"
                disabled={holdingSeats}
                onClick={onHoldSelectedSeats}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold"
              >
                {holdingSeats ? 'Locking...' : 'Hold (8m)'}
              </button>
            </div>
          </div>
        )}

        {/* PRIMARY COMPACT FLOATING CONTROL DOCK */}
        <div
          data-testid="compact-control-dock"
          className="pointer-events-auto flex items-center gap-1 sm:gap-1.5 overflow-x-auto max-w-full rounded-2xl bg-[#0B0F17]/90 backdrop-blur-xl border border-white/15 px-2 py-1.5 shadow-2xl"
        >
          {/* 1. Navigation Group */}
          <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label="Navigation Mode">
            <button
              type="button"
              onClick={() => {
                setIs2DFallback(false);
                setCameraMode('ORBIT');
              }}
              title="Orbit 3D Stadium"
              className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                !is2DFallback && cameraMode === 'ORBIT'
                  ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Orbit</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIs2DFallback(false);
                setCameraMode('FREE_FLY');
              }}
              title="Free-Fly (WASD)"
              className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                !is2DFallback && cameraMode === 'FREE_FLY'
                  ? 'bg-sky-600/25 text-sky-300 border border-sky-500/40'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Navigation className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Fly</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setIs2DFallback(false);
                setCameraMode(cameraMode === 'TOUR' ? 'ORBIT' : 'TOUR');
              }}
              title="Guided Stadium Tour"
              className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                !is2DFallback && cameraMode === 'TOUR'
                  ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Play className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Tour</span>
            </button>

            <button
              type="button"
              onClick={resetCamera}
              title="Reset Camera"
              aria-label="Reset Camera"
              className="inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium text-slate-300 hover:text-white hover:bg-white/5 transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Reset</span>
            </button>
          </div>

          <div className="h-5 w-px bg-white/10 shrink-0" aria-hidden="true" />

          {/* 2. Environment Group (Day / Dusk / Night + Slider) */}
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0" role="group" aria-label="Lighting & Time of Day">
            <button
              type="button"
              onClick={() => setTimeOfDayHours(14.0)}
              title="Day Lighting"
              className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                timeOfDayHours < 16.8
                  ? 'bg-emerald-600/25 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Day</span>
            </button>

            <button
              type="button"
              onClick={() => setTimeOfDayHours(17.75)}
              title="Dusk Lighting"
              className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                timeOfDayHours >= 16.8 && timeOfDayHours < 18.5
                  ? 'bg-amber-600/25 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Sunset className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Dusk</span>
            </button>

            <button
              type="button"
              onClick={() => setTimeOfDayHours(20.5)}
              title="Night Floodlights"
              className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                timeOfDayHours >= 18.5
                  ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-400/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Night</span>
            </button>

            <div className="hidden sm:flex items-center gap-1 pl-0.5">
              <input
                type="range"
                aria-label="Time of Day Solar Slider"
                min={9}
                max={21.5}
                step={0.25}
                value={timeOfDayHours}
                onChange={(e) => setTimeOfDayHours(Number(e.target.value))}
                className="w-14 accent-emerald-500 cursor-pointer"
              />
              <span className="font-mono text-[10px] text-slate-400 tabular-nums w-9">
                {formatSunClock(timeOfDayHours)}
              </span>
            </div>
          </div>

          <div className="h-5 w-px bg-white/10 shrink-0" aria-hidden="true" />

          {/* 3. View Group (3D / 2D + Roof Solid/X-Ray/Off) */}
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0" role="group" aria-label="View & Roof">
            <button
              type="button"
              onClick={() => setIs2DFallback(false)}
              title="3D Bowl View"
              className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                !is2DFallback
                  ? 'bg-sky-600/25 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <Box className="w-3.5 h-3.5" />
              <span>3D</span>
            </button>

            <button
              type="button"
              onClick={() => setIs2DFallback(true)}
              title="2D Seat Map"
              className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-1 rounded-lg text-[11px] font-medium transition-colors whitespace-nowrap ${
                is2DFallback
                  ? 'bg-sky-600/25 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>2D</span>
            </button>

            <div
              role="group"
              aria-label="Roof Visibility Mode"
              className="flex items-center bg-[#0F172A] rounded-lg border border-white/10 p-0.5 ml-0.5"
            >
              <Layers className="w-3 h-3 text-slate-400 mx-1 hidden lg:block" />
              {(
                [
                  { id: 'SOLID', label: 'Solid' },
                  { id: 'XRAY', label: 'X-Ray' },
                  { id: 'HIDDEN', label: 'Off' },
                ] as Array<{ id: RoofMode; label: string }>
              ).map((rm) => (
                <button
                  key={rm.id}
                  type="button"
                  onClick={() => setRoofMode(rm.id)}
                  className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] font-medium transition-colors whitespace-nowrap ${
                    roofMode === rm.id
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {rm.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-5 w-px bg-white/10 shrink-0" aria-hidden="true" />

          {/* 4. More (Advanced Drawer) + Hide Toggle */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-testid="controls-more-button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
              className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors whitespace-nowrap ${
                advancedOpen || hasActiveFilters
                  ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-[#0F172A] border-white/10 text-slate-200 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>More</span>
              {advancedOpen ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronUp className="w-3 h-3" />
              )}
            </button>

            <button
              type="button"
              data-testid="controls-collapse-button"
              onClick={() => setIsHudCollapsed(true)}
              aria-label="Hide Stadium Controls (H)"
              title="Cinema Mode / Hide Controls (H)"
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
