import React, { useMemo, useState } from 'react';
import { useStadiumStore } from '../store/useStadiumStore';
import { DEFAULT_STADIUM_SPEC } from '../shared/stadiumSpec';

export const FallbackSeatMap2D: React.FC = () => {
  const seats = useStadiumStore((s) => s.seats);
  const inventoryBySeatId = useStadiumStore((s) => s.inventoryBySeatId);
  const priceByCategoryId = useStadiumStore((s) => s.priceByCategoryId);
  const selectedSeatIds = useStadiumStore((s) => s.selectedSeatIds);
  const activeStandCode = useStadiumStore((s) => s.activeStandCode) || 'NORTH';
  const activeBlockCode = useStadiumStore((s) => s.activeBlockCode) || 'N-T2';
  const focusStand = useStadiumStore((s) => s.focusStand);
  const selectAndInspectSeat = useStadiumStore((s) => s.selectAndInspectSeat);
  const setIs2DFallback = useStadiumStore((s) => s.setIs2DFallback);
  const setSelectedSeatIds = useStadiumStore((s) => s.setSelectedSeatIds);
  const showToast = useStadiumStore((s) => s.showToast);

  const [groupSizeHelper, setGroupSizeHelper] = useState<number>(2);

  const currentStand = useMemo(
    () =>
      DEFAULT_STADIUM_SPEC.stands.find((st) => st.code === activeStandCode) ||
      DEFAULT_STADIUM_SPEC.stands[0],
    [activeStandCode]
  );

  const blockSeats = useMemo(
    () =>
      seats
        .filter((s) => s.blockCode === activeBlockCode)
        .sort((a, b) =>
          a.rowNumber !== b.rowNumber
            ? a.rowNumber - b.rowNumber
            : a.seatNumber - b.seatNumber
        ),
    [seats, activeBlockCode]
  );

  const handleFindTogether = () => {
    const byRow = new Map<number, typeof blockSeats>();
    for (const s of blockSeats) {
      const inv = inventoryBySeatId[s.id]?.status || 'AVAILABLE';
      if (inv !== 'AVAILABLE') continue;
      const list = byRow.get(s.rowNumber) ?? [];
      list.push(s);
      byRow.set(s.rowNumber, list);
    }

    for (const [, rowList] of byRow) {
      for (let i = 0; i <= rowList.length - groupSizeHelper; i++) {
        const slice = rowList.slice(i, i + groupSizeHelper);
        let contiguous = true;
        for (let k = 1; k < slice.length; k++) {
          if (slice[k].seatNumber !== slice[k - 1].seatNumber + 1) {
            contiguous = false;
            break;
          }
        }
        if (contiguous) {
          setSelectedSeatIds(slice.map((x) => x.id));
          showToast(
            `Selected ${groupSizeHelper} adjacent seats in ${activeBlockCode} Row ${slice[0].rowNumber}`,
            'success'
          );
          return;
        }
      }
    }
    showToast(
      `No ${groupSizeHelper} contiguous available seats found in block ${activeBlockCode}.`,
      'warning'
    );
  };

  return (
    <div className="w-full h-full bg-[#0B0F17] text-slate-100 overflow-y-auto pt-20 pb-36 px-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Interactive 2D Oval Bowl Selector */}
        <div className="lg:col-span-5 bg-[#111827] border border-white/10 rounded-xl p-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="font-semibold text-base text-white">
              2D Accessible Stadium Map
            </h2>
            <button
              type="button"
              onClick={() => setIs2DFallback(false)}
              className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-md"
            >
              Return to 3D Bowl
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-400">
            Select a stand sector on the oval diagram or use keyboard Tab navigation to inspect and book seats.
          </p>

          <div className="mt-4 flex justify-center">
            <svg
              viewBox="-140 -140 280 280"
              className="w-72 h-72"
              role="img"
              aria-label="2D Oval Cricket Stadium Stand Selector"
            >
              {/* Outfield Turf */}
              <ellipse
                cx="0"
                cy="0"
                rx="78"
                ry="68"
                fill="#1E5631"
                stroke="#F8FAFC"
                strokeWidth="1.5"
              />
              {/* 30-yard circle */}
              <ellipse
                cx="0"
                cy="0"
                rx="38"
                ry="33"
                fill="none"
                stroke="rgba(255,255,255,0.45)"
                strokeDasharray="4 4"
              />
              {/* 22-yard pitch */}
              <rect
                x="-4"
                y="-14"
                width="8"
                height="28"
                fill="#D6BC94"
                rx="1"
              />

              {/* 8 Radial Stand Sectors */}
              {DEFAULT_STADIUM_SPEC.stands.map((st) => {
                const rad = (st.orientationAngleDeg * Math.PI) / 180;
                const cx = Math.sin(rad) * 105;
                const cy = -Math.cos(rad) * 98;
                const isSelected = st.code === activeStandCode;
                return (
                  <g
                    key={st.code}
                    onClick={() => focusStand(st.code, st.blocks[0].code)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r="20"
                      fill={isSelected ? '#10B981' : '#1E293B'}
                      stroke={isSelected ? '#FFFFFF' : '#475569'}
                      strokeWidth="2"
                    />
                    <text
                      x={cx}
                      y={cy + 3}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="8.5"
                      fontWeight="bold"
                    >
                      {st.code.replace('_', '')}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Tier / Block Switcher for Selected Stand */}
          <div className="mt-4 space-y-2">
            <div className="text-xs font-medium text-slate-300">
              Blocks in {currentStand.name}:
            </div>
            <div className="grid grid-cols-3 gap-2">
              {currentStand.blocks.map((bl) => (
                <button
                  key={bl.code}
                  type="button"
                  onClick={() => focusStand(currentStand.code, bl.code)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition-colors ${
                    activeBlockCode === bl.code
                      ? 'bg-emerald-600/20 border-emerald-400 text-white'
                      : 'bg-[#0B0F17] border-white/10 text-slate-300 hover:border-white/25'
                  }`}
                >
                  <div className="font-mono font-semibold">{bl.code}</div>
                  <div className="text-[11px] text-slate-400 truncate">
                    Tier {bl.tier} · {bl.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Accessible Seat Grid for Active Block */}
        <div className="lg:col-span-7 bg-[#111827] border border-white/10 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-3">
            <div>
              <h3 className="font-semibold text-base text-white">
                Block {activeBlockCode} — Row & Seat Matrix
              </h3>
              <p className="text-xs text-slate-400">
                Pitch Direction: ↓ Towards Bottom of Grid · Non-color symbols included for accessibility
              </p>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="group-helper-select" className="text-xs text-slate-300">
                Group Finder:
              </label>
              <select
                id="group-helper-select"
                value={groupSizeHelper}
                onChange={(e) => setGroupSizeHelper(Number(e.target.value))}
                className="bg-[#0B0F17] border border-white/15 rounded px-2 py-1 text-xs text-white"
              >
                {[2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} Seats Together
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleFindTogether}
                className="px-3 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-md whitespace-nowrap"
              >
                Auto-Pick {groupSizeHelper}
              </button>
            </div>
          </div>

          {/* Legend with Non-Color Cues */}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-300">
            <span>● Available</span>
            <span className="text-cyan-400">◆ Selected</span>
            <span className="text-amber-400">▲ Held</span>
            <span className="text-slate-500">× Booked / Blocked</span>
          </div>

          {/* 10 Rows x 20 Seats Matrix */}
          <div className="mt-4 space-y-2 overflow-x-auto pb-2">
            {Array.from({ length: 10 }, (_, idx) => idx + 1).map((rowNum) => {
              const rowSeats = blockSeats.filter((s) => s.rowNumber === rowNum);
              return (
                <div key={rowNum} className="flex items-center gap-1.5">
                  <span className="w-12 shrink-0 font-mono text-[11px] text-slate-400">
                    Row {String(rowNum).padStart(2, '0')}
                  </span>
                  <div className="flex items-center gap-1">
                    {rowSeats.map((seat) => {
                      const invStatus =
                        inventoryBySeatId[seat.id]?.status || 'AVAILABLE';
                      const isSelected = selectedSeatIds.includes(seat.id);
                      const price = priceByCategoryId[seat.categoryId] ?? 180000;
                      const symbol = isSelected
                        ? '◆'
                        : invStatus === 'AVAILABLE'
                        ? '●'
                        : invStatus === 'HELD'
                        ? '▲'
                        : '×';

                      return (
                        <button
                          key={seat.id}
                          type="button"
                          onClick={() => selectAndInspectSeat(seat)}
                          aria-label={`Seat ${seat.seatCode}, Row ${seat.rowNumber} Seat ${seat.seatNumber}, ${seat.categoryName}, Price ₹${price / 100}, Status ${invStatus}`}
                          title={`${seat.seatCode} · ₹${price / 100} · View Score ${seat.viewQualityScore}/100 (Click to fly into 3D Seat View)`}
                          className={`w-7 h-7 rounded text-[10px] font-mono flex flex-col items-center justify-center border transition-colors ${
                            isSelected
                              ? 'bg-cyan-500 text-slate-950 border-white font-bold'
                              : invStatus === 'AVAILABLE'
                              ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40 hover:bg-emerald-700 hover:text-white cursor-pointer'
                              : invStatus === 'HELD'
                              ? 'bg-amber-950/60 text-amber-400 border-amber-500/40 cursor-not-allowed'
                              : 'bg-slate-900 text-slate-600 border-white/5 cursor-not-allowed'
                          }`}
                        >
                          <span>{symbol}</span>
                          <span className="text-[8px] leading-none">
                            {seat.seatNumber}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
