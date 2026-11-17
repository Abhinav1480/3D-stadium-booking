import React, { useEffect, useMemo } from 'react';
import { Eye, Headphones } from 'lucide-react';
import { useStadiumStore } from '../store/useStadiumStore';
import {
  DEFAULT_STADIUM_SPEC,
  computeSeatViewTelemetry,
} from '../shared/stadiumSpec';
import { resolveSeatAvailabilityStatus } from '../shared/seatingSpatial';
import { soundEngine } from '../utils/soundEngine';

export const ViewFromSeatHud: React.FC = () => {
  const focusedSeat = useStadiumStore((s) => s.focusedSeat);
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const isInspectorCollapsed = useStadiumStore((s) => s.isInspectorCollapsed);
  const setIsInspectorCollapsed = useStadiumStore((s) => s.setIsInspectorCollapsed);
  const timeOfDayHours = useStadiumStore((s) => s.timeOfDayHours);
  const setTimeOfDayHours = useStadiumStore((s) => s.setTimeOfDayHours);
  const seatViewFov = useStadiumStore((s) => s.seatViewFov);
  const seatViewYawOffsetDeg = useStadiumStore((s) => s.seatViewYawOffsetDeg);
  const seatViewPitchOffsetDeg = useStadiumStore((s) => s.seatViewPitchOffsetDeg);
  const setSeatViewLook = useStadiumStore((s) => s.setSeatViewLook);
  const focusStand = useStadiumStore((s) => s.focusStand);
  const toggleSeatSelection = useStadiumStore((s) => s.toggleSeatSelection);
  const selectedSeatIds = useStadiumStore((s) => s.selectedSeatIds);
  const comparisonSeats = useStadiumStore((s) => s.comparisonSeats);
  const toggleComparisonSeat = useStadiumStore((s) => s.toggleComparisonSeat);
  const enterSeatView = useStadiumStore((s) => s.enterSeatView);
  const exitSeatView = useStadiumStore((s) => s.exitSeatView);
  const priceByCategoryId = useStadiumStore((s) => s.priceByCategoryId);
  const inventoryBySeatId = useStadiumStore((s) => s.inventoryBySeatId);
  const activeHold = useStadiumStore((s) => s.activeHold);
  const currentUserId = useStadiumStore((s) => s.currentUser.id);
  const crowdAudioEnabled = useStadiumStore((s) => s.crowdAudioEnabled);
  const setCrowdAudioEnabled = useStadiumStore((s) => s.setCrowdAudioEnabled);
  const showToast = useStadiumStore((s) => s.showToast);

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
      if (e.code === 'KeyI' || e.key === 'i' || e.key === 'I') {
        const st = useStadiumStore.getState();
        if (st.activeModal !== 'NONE' || st.is2DFallback || !st.focusedSeat) return;
        st.setIsInspectorCollapsed(!st.isInspectorCollapsed);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const telemetry = useMemo(() => {
    if (!focusedSeat) return null;
    return computeSeatViewTelemetry(
      focusedSeat,
      timeOfDayHours,
      DEFAULT_STADIUM_SPEC
    );
  }, [focusedSeat, timeOfDayHours]);

  if (!focusedSeat || !telemetry) return null;

  const isSelected = selectedSeatIds.includes(focusedSeat.id);
  const isPinnedCompare = comparisonSeats.some((c) => c.id === focusedSeat.id);
  const seatPricePaise = priceByCategoryId[focusedSeat.categoryId] ?? 180000;
  const inv = inventoryBySeatId[focusedSeat.id];
  const availability = resolveSeatAvailabilityStatus({
    rawStatus: inv?.status,
    holdUserId: inv?.holdUserId,
    holdToken: inv?.holdToken,
    holdExpiresAt: inv?.holdExpiresAt,
    currentUserId,
    activeHoldToken: activeHold?.holdToken,
    isSelected,
  });
  const seatStatus = inv?.status || 'AVAILABLE';

  const handleShareSeatLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('seat', focusedSeat.seatCode);
    url.searchParams.set('autostart', '1');
    navigator.clipboard?.writeText(url.toString()).catch(() => {});
    showToast(`Copied shareable link for ${focusedSeat.seatCode}`, 'success');
  };

  return (
    <>
      {/* First-Person Seat View Exit Bar (Always Accessible Even When Inspector Is Hidden) */}
      {cameraMode === 'SEAT_VIEW' && (
        <div className="fixed top-[4.25rem] left-1/2 -translate-x-1/2 z-30 flex items-center gap-2.5 rounded-xl bg-[#0F172A]/95 border border-emerald-500/40 px-3 py-1.5 text-xs text-slate-100 shadow-2xl">
          <span className="font-mono font-bold text-emerald-400 whitespace-nowrap">
            {focusedSeat.seatCode}
          </span>
          <span className="hidden sm:inline text-[11px] text-slate-300 whitespace-nowrap">
            · {focusedSeat.standName}
          </span>
          <button
            type="button"
            onClick={() => exitSeatView()}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-[11px] font-semibold text-white whitespace-nowrap transition-colors"
          >
            Exit Seat View
          </button>
        </div>
      )}

      {/* Separate Floating Toggle Button Outside Panel Container (Visible When Collapsed) */}
      <div
        className={`fixed top-[4.25rem] right-3 sm:right-5 z-30 transition-[transform,opacity] duration-300 ease-out ${
          isInspectorCollapsed
            ? 'translate-x-0 opacity-100 pointer-events-auto'
            : 'translate-x-4 opacity-0 pointer-events-none'
        }`}
        aria-hidden={!isInspectorCollapsed}
      >
        <button
          type="button"
          onClick={() => setIsInspectorCollapsed(false)}
          aria-expanded={!isInspectorCollapsed}
          aria-controls="seat-sightline-inspector-panel"
          tabIndex={isInspectorCollapsed ? 0 : -1}
          className="px-3.5 py-1.5 rounded-lg bg-[#0F172A]/95 hover:bg-slate-800 border border-emerald-500/40 text-xs font-semibold text-slate-100 hover:text-white shadow-2xl whitespace-nowrap flex items-center gap-1.5 transition-colors"
        >
          <span>◂ Show Inspector</span>
          <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-white/15 font-mono text-[10px] text-emerald-400">
            I
          </kbd>
        </button>
      </div>

      {/* Focused Seat Sightline Telemetry Card (Top-Right Floating Flex-Column Panel) */}
      <aside
        id="seat-sightline-inspector-panel"
        aria-label="View From My Seat Telemetry"
        aria-hidden={isInspectorCollapsed}
        inert={isInspectorCollapsed}
        className={`fixed top-[4.25rem] right-3 sm:right-5 z-20 w-[min(344px,calc(100vw-1.5rem))] max-h-[min(56vh,calc(100vh-10rem))] sm:max-h-[min(62vh,calc(100vh-12rem))] flex flex-col overflow-hidden rounded-xl bg-[#0F172A] border border-white/15 p-3.5 text-slate-100 shadow-2xl transition-[transform,opacity] duration-300 ease-out ${
          isInspectorCollapsed
            ? 'translate-x-[calc(100%+2rem)] opacity-0 pointer-events-none'
            : 'translate-x-0 opacity-100 pointer-events-auto'
        }`}
      >
        {/* Fixed Inspector Header */}
        <div className="shrink-0">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5 mb-1.5">
            <span className="text-[11px] font-medium text-emerald-400">
              {cameraMode === 'SEAT_VIEW'
                ? 'First-Person Seat Camera Active'
                : 'Seat Sightline Inspector'}
            </span>
            <button
              type="button"
              onClick={() => setIsInspectorCollapsed(true)}
              aria-expanded={!isInspectorCollapsed}
              aria-controls="seat-sightline-inspector-panel"
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-white/20 text-[11px] font-semibold text-slate-100 hover:text-white whitespace-nowrap flex items-center gap-1 transition-colors"
            >
              <span>Hide Inspector</span>
              <kbd className="px-1 rounded bg-[#0B0F17] border border-white/15 font-mono text-[10px] text-slate-300">
                I
              </kbd>
            </button>
          </div>

          <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-mono text-base font-bold text-white">
                  {focusedSeat.seatCode}
                </h2>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                    availability.effectiveStatus === 'AVAILABLE'
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : availability.effectiveStatus === 'SELECTED'
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50'
                      : availability.effectiveStatus === 'HELD_BY_CURRENT_USER'
                      ? 'bg-purple-500/20 text-purple-300 border-purple-400/50'
                      : availability.effectiveStatus === 'HELD'
                      ? 'bg-amber-500/20 text-amber-300 border-amber-400/50'
                      : availability.effectiveStatus === 'BOOKED'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                      : 'bg-slate-700/50 text-slate-300 border-slate-500/50'
                  }`}
                >
                  {availability.symbol} {availability.label}
                </span>
              </div>
              <div className="text-[11px] text-slate-300 mt-0.5 truncate">
                {focusedSeat.standName} · {focusedSeat.blockName}
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="font-mono text-lg font-bold text-emerald-400 tabular-nums">
                {telemetry.viewQualityScore}
                <span className="text-xs text-slate-400 font-normal">/100</span>
              </div>
              <div className="text-[10px] text-slate-400">View Score</div>
            </div>
          </div>

          {/* Pinned Side-by-Side Primary Top Action Row (Headphone Audio + 3D Eye View) */}
          <div
            data-testid="inspector-pinned-actions"
            className="grid grid-cols-2 gap-2 py-2.5 border-b border-white/10"
          >
            <button
              type="button"
              data-testid="inspector-headphone-action"
              aria-pressed={crowdAudioEnabled}
              aria-label={crowdAudioEnabled ? 'Mute Stadium Acoustics' : 'Listen to Stadium Acoustics'}
              onClick={() => {
                const next = !crowdAudioEnabled;
                setCrowdAudioEnabled(next);
                soundEngine.toggleCrowdMurmur(next);
              }}
              className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border text-[11px] font-semibold transition-colors whitespace-nowrap ${
                crowdAudioEnabled
                  ? 'bg-emerald-600/25 border-emerald-400/70 text-emerald-200 hover:bg-emerald-600/35'
                  : 'bg-[#0B0F17] hover:bg-slate-800 border-white/15 text-slate-200 hover:text-white'
              }`}
            >
              <Headphones className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
              <span>{crowdAudioEnabled ? 'Audio: On' : 'Stadium Audio'}</span>
            </button>

            {cameraMode !== 'SEAT_VIEW' ? (
              <button
                type="button"
                data-testid="inspector-eye-action"
                aria-label="View From Here (3D Eye)"
                onClick={() => enterSeatView(focusedSeat, telemetry)}
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold transition-colors whitespace-nowrap shadow-sm"
              >
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span>View From Here</span>
              </button>
            ) : (
              <button
                type="button"
                data-testid="inspector-eye-action"
                aria-label="Exit Seat View"
                onClick={() => exitSeatView()}
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-sky-500/40 text-sky-200 hover:text-white text-[11px] font-semibold transition-colors whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                <span>Exit Seat View</span>
              </button>
            )}
          </div>
        </div>

        {/* Independently Scrollable Lower Content Area */}
        <div
          data-testid="inspector-scroll-body"
          className="flex-1 min-h-0 overflow-y-auto pt-2.5 pr-0.5 space-y-2.5"
        >
          {/* Plain-Language Sightline Summary */}
          <p className="text-[11px] text-slate-300 leading-snug">
            {telemetry.summaryExplanation}
          </p>

          {/* Computed Spatial & Solar Metrics Grid */}
          <div className="grid grid-cols-2 gap-1.5 text-xs border-t border-white/10 pt-2 font-mono tabular-nums">
            <div className="bg-[#0B0F17] rounded-lg px-2 py-1.5 border border-white/5">
              <div className="text-[10px] font-sans text-slate-400">Pitch Distance</div>
              <div className="text-white font-semibold">{telemetry.distanceToPitchM} m</div>
            </div>
            <div className="bg-[#0B0F17] rounded-lg px-2 py-1.5 border border-white/5">
              <div className="text-[10px] font-sans text-slate-400">Boundary Rope</div>
              <div className="text-white font-semibold">{telemetry.distanceToBoundaryM} m</div>
            </div>
            <div className="bg-[#0B0F17] rounded-lg px-2 py-1.5 border border-white/5">
              <div className="text-[10px] font-sans text-slate-400">Elevation / Rake</div>
              <div className="text-white font-semibold">{telemetry.elevationAngleDeg}°</div>
            </div>
            <div className="bg-[#0B0F17] rounded-lg px-2 py-1.5 border border-white/5">
              <div className="text-[10px] font-sans text-slate-400">Pitch Axis Angle</div>
              <div className="text-white font-semibold">{telemetry.horizontalAngleDeg}°</div>
            </div>
            <div className="bg-[#0B0F17] rounded-lg px-2 py-1.5 border border-white/5">
              <div className="text-[10px] font-sans text-slate-400">Canopy Shade</div>
              <div className="text-sky-400 font-semibold">{telemetry.shadePctAtTime}%</div>
            </div>
            <div className="bg-[#0B0F17] rounded-lg px-2 py-1.5 border border-white/5">
              <div className="text-[10px] font-sans text-slate-400">8K Scoreboard</div>
              <div className="text-emerald-400 font-semibold">
                {telemetry.scoreboardVisible ? 'Clear Line' : 'Opposite Screen'}
              </div>
            </div>
          </div>

          {telemetry.obstructionWarning !== 'NONE' && (
            <div className="text-[11px] text-amber-300 bg-amber-950/50 border border-amber-500/30 rounded px-2.5 py-1.5">
              Note: {telemetry.obstructionWarning}
            </div>
          )}

          {/* First-Person 360 Look & FOV Controls when inside SEAT_VIEW */}
          {cameraMode === 'SEAT_VIEW' && (
            <div className="border-t border-white/10 pt-2.5 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>Head Pan (Yaw): {seatViewYawOffsetDeg}°</span>
                <button
                  type="button"
                  onClick={() => setSeatViewLook(0, 0, 64)}
                  className="text-emerald-400 hover:underline"
                >
                  Center on Pitch
                </button>
              </div>
              <input
                type="range"
                aria-label="Head Pan Yaw Angle"
                min={-80}
                max={80}
                value={seatViewYawOffsetDeg}
                onChange={(e) =>
                  setSeatViewLook(Number(e.target.value), seatViewPitchOffsetDeg)
                }
                className="w-full accent-emerald-500 h-1.5 bg-slate-800 rounded"
              />

              <div className="flex items-center justify-between text-[11px] text-slate-300">
                <span>Eye Zoom (FOV): {seatViewFov}°</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTimeOfDayHours(14.0)}
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      timeOfDayHours < 16.8
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    Day
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeOfDayHours(17.75)}
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      timeOfDayHours >= 16.8 && timeOfDayHours < 18.5
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    Dusk
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeOfDayHours(20.5)}
                    className={`px-1.5 py-0.5 rounded text-[10px] ${
                      timeOfDayHours >= 18.5
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    Night
                  </button>
                </div>
              </div>
              <input
                type="range"
                aria-label="Field of View Zoom"
                min={30}
                max={72}
                value={seatViewFov}
                onChange={(e) =>
                  setSeatViewLook(
                    seatViewYawOffsetDeg,
                    seatViewPitchOffsetDeg,
                    Number(e.target.value)
                  )
                }
                className="w-full accent-sky-500 h-1.5 bg-slate-800 rounded"
              />
            </div>
          )}

          {/* Booking Selection & Secondary Actions */}
          <div className="pt-2.5 border-t border-white/10 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => toggleSeatSelection(focusedSeat.id)}
              className={`w-full py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                isSelected
                  ? 'bg-rose-600 hover:bg-rose-500 text-white'
                  : availability.effectiveStatus === 'AVAILABLE'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : availability.effectiveStatus === 'HELD_BY_CURRENT_USER'
                  ? 'bg-purple-600 hover:bg-purple-500 text-white'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
              }`}
            >
              {isSelected
                ? 'Remove Seat'
                : seatStatus === 'AVAILABLE'
                ? `Select ₹${(seatPricePaise / 100).toLocaleString('en-IN')}`
                : `${availability.symbol} ${availability.label}`}
            </button>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => toggleComparisonSeat(focusedSeat)}
                className="flex-1 py-1.5 px-2.5 rounded bg-[#0B0F17] hover:bg-slate-800 border border-white/10 text-[11px] text-slate-300 whitespace-nowrap"
              >
                {isPinnedCompare
                  ? 'Unpin from Compare'
                  : `Compare Seat (${comparisonSeats.length}/3)`}
              </button>
              <button
                type="button"
                onClick={handleShareSeatLink}
                className="py-1.5 px-2.5 rounded bg-[#0B0F17] hover:bg-slate-800 border border-white/10 text-[11px] text-slate-300 whitespace-nowrap"
              >
                Share Link
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Side-by-Side 3-Seat Comparison Tray (Top-Left when >=1 seat pinned) */}
      {comparisonSeats.length > 0 && (
        <section
          aria-label="Seat Comparison Tray"
          className="fixed top-20 left-5 z-20 max-w-md rounded-xl bg-[#0F172A] border border-white/15 p-3.5 text-slate-100 shadow-xl"
        >
          <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-2">
            <span className="text-xs font-semibold text-white">
              Side-by-Side Seat Comparison ({comparisonSeats.length}/3)
            </span>
            <span className="text-[11px] text-slate-400">
              Click any card to jump camera
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {comparisonSeats.map((cs) => {
              const price = priceByCategoryId[cs.categoryId] ?? 180000;
              const isCurrent = focusedSeat?.id === cs.id;
              return (
                <div
                  key={cs.id}
                  onClick={() => enterSeatView(cs)}
                  className={`cursor-pointer rounded-lg p-2 border transition-colors ${
                    isCurrent
                      ? 'bg-emerald-950/50 border-emerald-400'
                      : 'bg-[#0B0F17] border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold text-emerald-400">
                      {cs.seatCode}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleComparisonSeat(cs);
                      }}
                      aria-label={`Remove ${cs.seatCode} from comparison`}
                      className="text-[10px] text-slate-400 hover:text-white"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-1 font-mono text-xs text-white tabular-nums">
                    ₹{(price / 100).toLocaleString('en-IN')}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-300 space-y-0.5 font-mono tabular-nums">
                    <div>Score: {cs.viewQualityScore}/100</div>
                    <div>Pitch: {cs.distanceToPitchM}m</div>
                    <div>Angle: {cs.horizontalAngleDeg}°</div>
                    <div>Shade: {cs.shadeAfternoonPct}%</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
};
