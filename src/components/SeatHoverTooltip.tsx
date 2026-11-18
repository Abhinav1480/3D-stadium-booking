import React, { useEffect, useState } from 'react';
import { useStadiumStore } from '../store/useStadiumStore';
import { resolveSeatAvailabilityStatus } from '../shared/seatingSpatial';
import { recordReactRender } from '../utils/perfProfiler';

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const SeatHoverTooltip: React.FC<{
  tooltipRef: React.RefObject<HTMLDivElement | null>;
}> = React.memo(({ tooltipRef }) => {
  recordReactRender('SeatHoverTooltip');
  const hoveredSeat = useStadiumStore((s) => s.hoveredSeat);
  const cameraMode = useStadiumStore((s) => s.cameraMode);
  const inventoryBySeatId = useStadiumStore((s) => s.inventoryBySeatId);
  const priceByCategoryId = useStadiumStore((s) => s.priceByCategoryId);
  const selectedSeatIds = useStadiumStore((s) => s.selectedSeatIds);
  const activeHold = useStadiumStore((s) => s.activeHold);
  const currentUserId = useStadiumStore((s) => s.currentUser.id);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const inv = hoveredSeat ? inventoryBySeatId[hoveredSeat.id] : undefined;
  const isHoveredHeld = inv?.status === 'HELD';

  useEffect(() => {
    if (!isHoveredHeld) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isHoveredHeld, hoveredSeat?.id]);

  if (!hoveredSeat || cameraMode === 'SEAT_VIEW') return null;

  const isSelected = selectedSeatIds.includes(hoveredSeat.id);
  const descriptor = resolveSeatAvailabilityStatus({
    rawStatus: inv?.status,
    holdUserId: inv?.holdUserId,
    holdToken: inv?.holdToken,
    holdExpiresAt: inv?.holdExpiresAt,
    currentUserId,
    activeHoldToken: activeHold?.holdToken,
    isSelected,
    nowMs,
  });

  const hoveredPricePaise = priceByCategoryId[hoveredSeat.categoryId] ?? 180000;

  const badgeClass =
    descriptor.effectiveStatus === 'AVAILABLE'
      ? 'text-emerald-400'
      : descriptor.effectiveStatus === 'SELECTED'
      ? 'text-cyan-300'
      : descriptor.effectiveStatus === 'HELD_BY_CURRENT_USER'
      ? 'text-purple-300'
      : descriptor.effectiveStatus === 'HELD'
      ? 'text-amber-400'
      : descriptor.effectiveStatus === 'BOOKED'
      ? 'text-rose-400'
      : 'text-slate-400';

  return (
    <div
      ref={tooltipRef}
      role="status"
      data-testid="seat-hover-tooltip"
      style={{ transform: 'translate3d(24px, 24px, 0)' }}
      className="pointer-events-none fixed top-0 left-0 z-30 w-72 rounded-lg bg-[#0F172A]/95 border border-white/15 p-3 shadow-2xl text-slate-100"
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
        <span className="font-mono text-xs font-bold text-emerald-400">
          {hoveredSeat.seatCode}
        </span>
        <span className="font-mono text-xs font-semibold text-white tabular-nums">
          ₹{(hoveredPricePaise / 100).toLocaleString('en-IN')}
        </span>
      </div>
      <div className="mt-1.5 text-xs font-medium text-slate-200">
        {hoveredSeat.standName} · Tier {hoveredSeat.tier} · {hoveredSeat.blockName} ({hoveredSeat.blockCode})
      </div>
      <div className="mt-0.5 text-[11px] text-slate-400">
        Row {hoveredSeat.rowNumber} · Seat {hoveredSeat.seatNumber} · {hoveredSeat.categoryName}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] font-mono border-t border-white/10 pt-1.5">
        <span className="text-sky-400">
          Sightline: {hoveredSeat.viewQualityScore}/100
        </span>
        <span className={`font-semibold ${badgeClass}`}>
          {descriptor.symbol} {descriptor.label}
          {descriptor.remainingSec !== null && ` (${formatCountdown(descriptor.remainingSec)})`}
        </span>
      </div>
    </div>
  );
});
