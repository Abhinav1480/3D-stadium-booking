import React, { useEffect, useRef, useState } from 'react';
import { DEFAULT_STADIUM_SPEC } from '../shared/stadiumSpec';
import { useStadiumStore } from '../store/useStadiumStore';
import { recordReactRender } from '../utils/perfProfiler';

/**
 * Compact interactive Top-Left Radar Mini-Map showing:
 * - All 8 clickable stadium stands & outfield/pitch geometry
 * - Facility hotspots (Gates, Lounges, Food Courts, Medical, Scoreboards)
 * - Live camera position & look-cone updated imperatively at zero React re-render cost
 */
export const StadiumMiniMap: React.FC = React.memo(() => {
  recordReactRender('StadiumMiniMap');
  const activeStandCode = useStadiumStore((s) => s.activeStandCode);
  const focusStand = useStadiumStore((s) => s.focusStand);
  const comparisonCount = useStadiumStore((s) => s.comparisonSeats.length);
  const setActiveHotspot = useStadiumStore((s) => s.setActiveHotspot);
  const isBowlRadarVisible = useStadiumStore((s) => s.isBowlRadarVisible);
  const [expanded, setExpanded] = useState(true);

  const markerGroupRef = useRef<SVGGElement | null>(null);

  useEffect(() => {
    const onTelemetry = (ev: Event) => {
      const detail = (ev as CustomEvent<{ x: number; z: number; yawDeg: number }>).detail;
      const g = markerGroupRef.current;
      if (!g || !detail) return;
      // Clamp within SVG coordinate box [-128..128]
      const mx = Math.max(-122, Math.min(122, detail.x));
      const mz = Math.max(-122, Math.min(122, detail.z));
      g.setAttribute(
        'transform',
        `translate(${mx.toFixed(1)}, ${mz.toFixed(1)}) rotate(${detail.yawDeg.toFixed(1)})`
      );
    };
    window.addEventListener('stadiumx:camera-radar', onTelemetry);
    return () => window.removeEventListener('stadiumx:camera-radar', onTelemetry);
  }, []);

  if (!isBowlRadarVisible) return null;

  // Shift cleanly below comparison tray if comparison tray is open
  const topPositionClass = comparisonCount > 0 ? 'top-[19.5rem]' : 'top-[4.25rem] sm:top-20';

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`fixed ${topPositionClass} left-3 sm:left-4 md:left-5 z-20 px-3 py-1.5 rounded-lg bg-[#0F172A]/95 border border-white/15 text-[11px] font-medium text-slate-200 hover:text-white shadow-lg transition-all duration-300`}
      >
        Show Radar Map
      </button>
    );
  }

  return (
    <aside
      aria-label="Stadium Interactive Mini-Map"
      className={`block fixed ${topPositionClass} left-3 sm:left-4 md:left-5 z-20 w-36 sm:w-44 rounded-xl bg-[#0F172A]/95 border border-white/15 p-2 sm:p-2.5 text-slate-100 shadow-2xl transition-all duration-300`}
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
          Bowl Radar
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => focusStand(null, null)}
            className="text-[10px] text-slate-300 hover:text-white"
            title="Full 360 Bowl Overview"
          >
            360°
          </button>
          <button
            type="button"
            onClick={() => setExpanded(false)}
            aria-label="Minimize Radar Map"
            className="text-[10px] text-slate-400 hover:text-white px-1"
          >
            –
          </button>
        </div>
      </div>

      <svg
        viewBox="-135 -135 270 270"
        className="w-full h-36 select-none"
        role="img"
        aria-label="Interactive stadium stand mini-map"
      >
        {/* Outer bowl ring */}
        <ellipse
          cx="0"
          cy="0"
          rx="116"
          ry="104"
          fill="#0B1322"
          stroke="rgba(148,163,184,0.28)"
          strokeWidth="1.5"
        />
        {/* Turf */}
        <ellipse
          cx="0"
          cy="0"
          rx="84"
          ry="72"
          fill="#174E2B"
          stroke="rgba(248,250,252,0.45)"
          strokeWidth="1.2"
        />
        {/* Pitch */}
        <rect x="-2.5" y="-11" width="5" height="22" rx="1" fill="#D6BC94" />

        {/* 8 Clickable Stand Arcs/Nodes */}
        {DEFAULT_STADIUM_SPEC.stands.map((st) => {
          const rad = (st.orientationAngleDeg * Math.PI) / 180;
          const cx = Math.sin(rad) * 100;
          const cz = -Math.cos(rad) * 88;
          const isActive = activeStandCode === st.code;
          const label = st.code
            .replace('NORTH_EAST', 'NE')
            .replace('SOUTH_EAST', 'SE')
            .replace('SOUTH_WEST', 'SW')
            .replace('NORTH_WEST', 'NW')
            .replace('NORTH', 'N')
            .replace('SOUTH', 'S')
            .replace('EAST', 'E')
            .replace('WEST', 'W');
          return (
            <g
              key={st.code}
              onClick={() => focusStand(st.code, null)}
              className="cursor-pointer"
            >
              <circle
                cx={cx}
                cy={cz}
                r="14"
                fill={isActive ? '#10B981' : '#1E293B'}
                stroke={isActive ? '#FFFFFF' : '#475569'}
                strokeWidth="1.6"
              />
              <text
                x={cx}
                y={cz + 3}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="9"
                fontWeight="700"
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Clickable Facility Hotspot Pins */}
        {DEFAULT_STADIUM_SPEC.hotspots.map((hs) => (
          <circle
            key={hs.id}
            cx={Math.max(-124, Math.min(124, hs.position[0]))}
            cy={Math.max(-124, Math.min(124, hs.position[2]))}
            r="3.8"
            fill="#FBBF24"
            stroke="#0F172A"
            strokeWidth="1"
            className="cursor-pointer"
            onClick={() => setActiveHotspot(hs)}
          >
            <title>{hs.label}</title>
          </circle>
        ))}

        {/* Live Camera Position & Forward View Cone */}
        <g ref={markerGroupRef} transform="translate(0, 86) rotate(0)">
          <path d="M 0 0 L -14 -26 L 14 -26 Z" fill="rgba(56, 189, 248, 0.34)" />
          <circle cx="0" cy="0" r="5" fill="#38BDF8" stroke="#FFFFFF" strokeWidth="1.5" />
        </g>
      </svg>

      <div className="mt-1 flex items-center justify-between text-[9px] text-slate-400">
        <span>Click stand / pin</span>
        <span className="text-sky-400">● Live Cam</span>
      </div>
    </aside>
  );
});
