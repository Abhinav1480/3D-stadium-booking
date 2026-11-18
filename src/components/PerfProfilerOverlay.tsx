import React, { useEffect, useRef, useState } from 'react';
import {
  getLatestProfilerSample,
  getRollingHistory,
  startProfileRecording,
  stopProfileRecording,
} from '../utils/perfProfiler';

/**
 * Lightweight, imperatively updated WebGL + React Performance Overlay.
 * Toggled with keyboard 'P' or '?profile=1'. Causes zero React re-renders during camera motion.
 */
export const PerfProfilerOverlay: React.FC = () => {
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('profile') === '1';
  });

  const graphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fpsRef = useRef<HTMLSpanElement | null>(null);
  const frameRef = useRef<HTMLSpanElement | null>(null);
  const drawsRef = useRef<HTMLSpanElement | null>(null);
  const trisRef = useRef<HTMLSpanElement | null>(null);
  const memRef = useRef<HTMLSpanElement | null>(null);
  const jsGpuRef = useRef<HTMLSpanElement | null>(null);
  const rpsRef = useRef<HTMLSpanElement | null>(null);
  const dprRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) || active.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'KeyP' || e.key === 'p' || e.key === 'P') {
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    (window as any).__STADIUMX_PROFILE__ = {
      toggleOverlay: () => setVisible((v) => !v),
      showOverlay: (val: boolean) => setVisible(val),
      startRecording: startProfileRecording,
      stopRecording: stopProfileRecording,
      getLatest: getLatestProfilerSample,
      getHistory: getRollingHistory,
    };
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => {
      const s = getLatestProfilerSample();
      const hist = getRollingHistory();
      const fps = s.frameDeltaMs > 0.1 ? Math.min(240, Math.round(1000 / s.frameDeltaMs)) : 0;

      if (fpsRef.current) fpsRef.current.textContent = `${fps} fps`;
      if (frameRef.current) frameRef.current.textContent = `${s.frameDeltaMs.toFixed(1)} ms`;
      if (drawsRef.current) drawsRef.current.textContent = `${s.drawCalls}`;
      if (trisRef.current) trisRef.current.textContent = `${s.triangles.toLocaleString('en-US')}`;
      if (memRef.current) {
        memRef.current.textContent = `${s.geometries}G · ${s.textures}T (${s.textureMemoryMb.toFixed(1)} MB)`;
      }
      if (jsGpuRef.current) {
        jsGpuRef.current.textContent = `${s.jsMs.toFixed(2)} ms / ${s.gpuMs.toFixed(2)} ms`;
      }
      if (rpsRef.current) rpsRef.current.textContent = `${s.reactRendersPerSec} /s`;
      if (dprRef.current) dprRef.current.textContent = `${s.dpr.toFixed(2)}x`;

      const canvas = graphCanvasRef.current;
      if (canvas && hist.length > 0) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = '#070B12';
          ctx.fillRect(0, 0, w, h);

          // 16.6ms (60fps) & 33.3ms (30fps) target guide lines
          const y16 = h - Math.min(1, 16.67 / 50) * h;
          const y33 = h - Math.min(1, 33.33 / 50) * h;
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
          ctx.beginPath();
          ctx.moveTo(0, y16);
          ctx.lineTo(w, y16);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
          ctx.beginPath();
          ctx.moveTo(0, y33);
          ctx.lineTo(w, y33);
          ctx.stroke();

          const barW = w / 120;
          for (let i = 0; i < hist.length; i++) {
            const ms = hist.frameMs[i];
            const barH = Math.max(2, Math.min(h, (ms / 50) * h));
            ctx.fillStyle = ms <= 17 ? '#10B981' : ms <= 25 ? '#F59E0B' : '#EF4444';
            ctx.fillRect(i * barW, h - barH, Math.max(1, barW - 0.5), barH);
          }
        }
      }
    }, 200);

    return () => window.clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <aside
      data-testid="perf-profiler-overlay"
      aria-label="3D Performance Profiler"
      className="fixed bottom-28 left-3 sm:left-5 z-40 w-72 rounded-xl bg-[#0B0F17]/95 border border-emerald-500/40 p-2.5 text-[11px] font-mono text-slate-200 shadow-2xl pointer-events-auto"
    >
      <div className="flex items-center justify-between border-b border-white/10 pb-1 mb-1.5">
        <span className="font-bold text-emerald-400">3D PERF PROFILER (P)</span>
        <span ref={fpsRef} className="font-bold text-white tabular-nums whitespace-nowrap">
          -- fps
        </span>
      </div>

      <canvas
        ref={graphCanvasRef}
        width={268}
        height={38}
        className="w-full h-[38px] rounded border border-white/10 mb-1.5"
      />

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] tabular-nums">
        <span className="text-slate-400">Frame time</span>
        <span ref={frameRef} className="text-right text-white whitespace-nowrap">
          -- ms
        </span>
        <span className="text-slate-400">JS / GPU</span>
        <span ref={jsGpuRef} className="text-right text-sky-300 whitespace-nowrap">
          -- / --
        </span>
        <span className="text-slate-400">Draw calls</span>
        <span ref={drawsRef} className="text-right text-white whitespace-nowrap">
          --
        </span>
        <span className="text-slate-400">Triangles</span>
        <span ref={trisRef} className="text-right text-white whitespace-nowrap">
          --
        </span>
        <span className="text-slate-400">Geo · Tex</span>
        <span ref={memRef} className="text-right text-amber-300 whitespace-nowrap">
          --
        </span>
        <span className="text-slate-400">React/sec</span>
        <span ref={rpsRef} className="text-right text-emerald-300 whitespace-nowrap">
          0 /s
        </span>
        <span className="text-slate-400">Pixel ratio</span>
        <span ref={dprRef} className="text-right text-white whitespace-nowrap">
          --
        </span>
      </div>
    </aside>
  );
};
