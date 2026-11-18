import React, { useEffect, useMemo, useState } from 'react';
import { useStadiumStore } from '../store/useStadiumStore';
import { recordReactRender } from '../utils/perfProfiler';

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const SeatAvailabilityLegend: React.FC = React.memo(() => {
  recordReactRender('SeatAvailabilityLegend');
  const seats = useStadiumStore((s) => s.seats);
  const inventoryBySeatId = useStadiumStore((s) => s.inventoryBySeatId);
  const inventoryVersion = useStadiumStore((s) => s.inventoryVersion);
  const lastSocketDelta = useStadiumStore((s) => s.lastSocketDelta);
  const selectedSeatIds = useStadiumStore((s) => s.selectedSeatIds);
  const activeHold = useStadiumStore((s) => s.activeHold);
  const currentUserId = useStadiumStore((s) => s.currentUser.id);
  const seatVisualMode = useStadiumStore((s) => s.seatVisualMode);
  const setSeatVisualMode = useStadiumStore((s) => s.setSeatVisualMode);
  const isLegendCollapsed = useStadiumStore((s) => s.isLegendCollapsed);
  const setIsLegendCollapsed = useStadiumStore((s) => s.setIsLegendCollapsed);
  const isHudCollapsed = useStadiumStore((s) => s.isHudCollapsed);
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const activeStandCode = useStadiumStore((s) => s.activeStandCode);
  const setActiveModal = useStadiumStore((s) => s.setActiveModal);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const counts = useMemo(() => {
    let available = 0;
    let booked = 0;
    let heldOther = 0;
    let heldSelf = 0;
    let blocked = 0;
    let earliestSelfExpireMs = Infinity;

    const selectedSet = new Set(selectedSeatIds);

    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i];
      const inv = inventoryBySeatId[seat.id];
      const st = inv?.status || 'AVAILABLE';
      if (st === 'BOOKED') {
        booked++;
      } else if (st === 'BLOCKED') {
        blocked++;
      } else if (st === 'HELD') {
        const isMine =
          (activeHold?.holdToken && inv?.holdToken === activeHold.holdToken) ||
          (currentUserId && inv?.holdUserId === currentUserId);
        if (isMine) {
          heldSelf++;
          if (inv?.holdExpiresAt) {
            const exp = new Date(inv.holdExpiresAt).getTime();
            if (exp < earliestSelfExpireMs) earliestSelfExpireMs = exp;
          }
        } else {
          heldOther++;
        }
      } else if (!selectedSet.has(seat.id)) {
        available++;
      }
    }

    return {
      available,
      selected: selectedSeatIds.length,
      booked,
      heldOther,
      heldSelf,
      blocked,
      earliestSelfExpireMs: Number.isFinite(earliestSelfExpireMs)
        ? earliestSelfExpireMs
        : activeHold?.holdExpiresAt
        ? new Date(activeHold.holdExpiresAt).getTime()
        : null,
    };
  }, [
    seats,
    inventoryBySeatId,
    inventoryVersion,
    lastSocketDelta,
    selectedSeatIds,
    activeHold,
    currentUserId,
  ]);

  const hasActiveCountdown = counts.heldSelf > 0 || counts.heldOther > 0 || Boolean(activeHold);

  useEffect(() => {
    if (!hasActiveCountdown) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [hasActiveCountdown]);

  if (cameraMode === 'SEAT_VIEW' || seats.length === 0) return null;

  const selfRemainingSec =
    counts.earliestSelfExpireMs !== null
      ? Math.max(0, Math.floor((counts.earliestSelfExpireMs - nowMs) / 1000))
      : null;

  const hasCartStrip = selectedSeatIds.length > 0;
  const hasStandSubRow = Boolean(activeStandCode);
  const bottomPositionClass = isHudCollapsed
    ? 'bottom-16'
    : hasCartStrip && hasStandSubRow
    ? 'bottom-[calc(46vh+3.5rem)] sm:bottom-[16.75rem]'
    : hasCartStrip || hasStandSubRow
    ? 'bottom-[calc(46vh+3.5rem)] sm:bottom-[14rem]'
    : 'bottom-[calc(46vh+3.5rem)] sm:bottom-[11.75rem]';

  return (
    <>
      <div
        className={`fixed ${bottomPositionClass} left-3 sm:left-4 z-20 flex items-center gap-1.5 transition-[opacity,transform,bottom] duration-300 ease-out ${
          isLegendCollapsed
            ? 'opacity-100 translate-x-0 pointer-events-auto'
            : 'opacity-0 -translate-x-3 pointer-events-none'
        }`}
        aria-hidden={!isLegendCollapsed}
      >
        <button
          type="button"
          onClick={() => setIsLegendCollapsed(false)}
          aria-expanded={!isLegendCollapsed}
          aria-controls="seat-status-legend-panel"
          tabIndex={isLegendCollapsed ? 0 : -1}
          className="px-3 py-1.5 rounded-lg bg-[#0F172A]/95 hover:bg-slate-800 border border-white/15 text-[11px] font-medium text-slate-200 hover:text-white shadow-xl whitespace-nowrap flex items-center gap-1.5 transition-colors"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
          <span>Show Seat Status</span>
          {counts.heldSelf > 0 && selfRemainingSec !== null && (
            <span className="ml-1 font-mono text-purple-300">
              ★ {formatCountdown(selfRemainingSec)}
            </span>
          )}
        </button>
      </div>

      <aside
        id="seat-status-legend-panel"
        aria-label="Live 3D Seat Availability Legend"
        aria-hidden={isLegendCollapsed}
        inert={isLegendCollapsed}
        className={`fixed ${bottomPositionClass} left-3 sm:left-4 z-20 w-[min(218px,calc(100vw-1.5rem))] rounded-xl bg-[#0F172A]/95 border border-white/15 p-2.5 text-slate-100 shadow-2xl transition-[transform,opacity,bottom] duration-300 ease-out ${
          isLegendCollapsed
            ? '-translate-x-4 scale-95 opacity-0 pointer-events-none'
            : 'translate-x-0 scale-100 opacity-100 pointer-events-auto'
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2 mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            3D Seat Status
          </span>
          <button
            type="button"
            onClick={() => setIsLegendCollapsed(true)}
            aria-expanded={!isLegendCollapsed}
            aria-controls="seat-status-legend-panel"
            aria-label="Collapse Availability Legend"
            className="text-[11px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-[#0B0F17] border border-white/10 transition-colors"
          >
            Hide
          </button>
        </div>

      {/* Mode Switcher: Realistic Bowl vs High-Contrast Availability Clarity */}
      <div
        role="group"
        aria-label="Seating Visualization Mode"
        className="grid grid-cols-2 gap-1 bg-[#0B0F17] p-1 rounded-lg border border-white/10 mb-2.5"
      >
        <button
          type="button"
          onClick={() => setSeatVisualMode('REALISTIC')}
          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
            seatVisualMode === 'REALISTIC'
              ? 'bg-sky-600 text-white shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Realistic
        </button>
        <button
          type="button"
          onClick={() => setSeatVisualMode('AVAILABILITY')}
          className={`px-2 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
            seatVisualMode === 'AVAILABILITY'
              ? 'bg-emerald-600 text-white shadow'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Availability
        </button>
      </div>

      {/* 6 Distinct Color + Non-Color Symbol Indicators */}
      <ul className="space-y-1.5 text-[11px]">
        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-slate-200">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded border border-emerald-400 bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
              ●
            </span>
            Available
          </span>
          <span className="font-mono text-emerald-400 tabular-nums">
            {counts.available.toLocaleString('en-IN')}
          </span>
        </li>

        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-slate-200">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded border border-cyan-400 bg-cyan-500/25 text-cyan-300 text-[10px] font-bold">
              ✓
            </span>
            Selected
          </span>
          <span className="font-mono text-cyan-300 tabular-nums">{counts.selected}</span>
        </li>

        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-slate-200">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded border border-purple-400 bg-purple-500/25 text-purple-300 text-[10px] font-bold animate-pulse">
              ★
            </span>
            Reserved for You
          </span>
          <span className="font-mono text-purple-300 tabular-nums">
            {counts.heldSelf > 0 && selfRemainingSec !== null
              ? `${counts.heldSelf} · ${formatCountdown(selfRemainingSec)}`
              : counts.heldSelf}
          </span>
        </li>

        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-slate-200">
            <span className="inline-flex items-center justify-center w-4 h-4 rounded border border-amber-400 bg-amber-500/25 text-amber-300 text-[10px] font-bold animate-pulse">
              ⏱
            </span>
            Temporarily Held
          </span>
          <span className="font-mono text-amber-400 tabular-nums">{counts.heldOther}</span>
        </li>

        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-slate-200">
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded border border-rose-500 text-rose-300 text-[10px] font-bold"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, rgba(239,68,68,0.35) 0 2px, rgba(15,23,42,0.85) 2px 4px)',
              }}
            >
              ✕
            </span>
            Booked
          </span>
          <span className="font-mono text-rose-400 tabular-nums">
            {counts.booked.toLocaleString('en-IN')}
          </span>
        </li>

        <li className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-slate-200">
            <span
              className="inline-flex items-center justify-center w-4 h-4 rounded border border-slate-400 text-slate-300 text-[10px] font-bold"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, rgba(148,163,184,0.35) 0 2px, transparent 2px 4px), repeating-linear-gradient(-45deg, rgba(148,163,184,0.35) 0 2px, transparent 2px 4px)',
              }}
            >
              ⊘
            </span>
            Blocked / Maint.
          </span>
          <span className="font-mono text-slate-400 tabular-nums">{counts.blocked}</span>
        </li>
      </ul>

      {counts.heldSelf > 0 && activeHold && (
        <button
          type="button"
          onClick={() => setActiveModal('CHECKOUT')}
          className="mt-2.5 w-full py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-semibold transition-colors"
        >
          Resume Hold Checkout ({formatCountdown(selfRemainingSec ?? 0)})
        </button>
      )}
      </aside>
    </>
  );
});
