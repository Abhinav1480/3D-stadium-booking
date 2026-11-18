export interface FrameSample {
  timestampMs: number;
  frameDeltaMs: number;
  jsMs: number;
  gpuMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  textureMemoryMb: number;
  dpr: number;
  reactRendersPerSec: number;
}

export interface ProfileWindowSummary {
  sampleCount: number;
  durationSec: number;
  avgFps: number;
  avgFrameMs: number;
  p50FrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maxFrameMs: number;
  avgJsMs: number;
  avgGpuMs: number;
  avgDrawCalls: number;
  maxDrawCalls: number;
  avgTriangles: number;
  geometries: number;
  textures: number;
  textureMemoryMb: number;
  dpr: number;
  reactRendersPerSec: number;
  longTaskCount: number;
  longTaskMaxMs: number;
}

const HISTORY_LEN = 120;
const frameDeltaRing = new Float32Array(HISTORY_LEN);
const jsTimeRing = new Float32Array(HISTORY_LEN);
const gpuTimeRing = new Float32Array(HISTORY_LEN);
let ringHead = 0;
let ringCount = 0;

let latestSample: FrameSample = {
  timestampMs: 0,
  frameDeltaMs: 16.67,
  jsMs: 0,
  gpuMs: 0,
  drawCalls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  textureMemoryMb: 0,
  dpr: 1,
  reactRendersPerSec: 0,
};

// Sliding 1-second timestamp queue for React render count/sec (zero React state overhead)
const reactRenderTimestamps: number[] = [];
const reactRenderByComponent: Record<string, number> = {};

// Active recording buffer for Step 1 / Step 3 Playwright measurements
let recordingActive = false;
let recordingStartMs = 0;
let recordedSamples: FrameSample[] = [];
let recordedLongTasks: number[] = [];

if (typeof window !== 'undefined' && typeof PerformanceObserver !== 'undefined') {
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (recordingActive) {
          recordedLongTasks.push(entry.duration);
        }
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch {
    // longtask observer not supported in all environments
  }
}

export function recordReactRender(componentName = 'Scene'): void {
  const now = performance.now();
  reactRenderTimestamps.push(now);
  reactRenderByComponent[componentName] = (reactRenderByComponent[componentName] || 0) + 1;
  // Prune entries older than 1000ms
  const cutoff = now - 1000;
  while (reactRenderTimestamps.length > 0 && reactRenderTimestamps[0] < cutoff) {
    reactRenderTimestamps.shift();
  }
}

export function getReactRendersPerSec(): number {
  const cutoff = performance.now() - 1000;
  while (reactRenderTimestamps.length > 0 && reactRenderTimestamps[0] < cutoff) {
    reactRenderTimestamps.shift();
  }
  return reactRenderTimestamps.length;
}

export function estimateSceneTextureMemoryMb(scene: {
  traverse: (cb: (obj: any) => void) => void;
  environment?: any;
}): number {
  const seen = new Set<string>();
  let totalBytes = 0;

  const accountTex = (tex: any) => {
    if (!tex || !tex.uuid || seen.has(tex.uuid)) return;
    seen.add(tex.uuid);
    const img = tex.image as
      | { width?: number; height?: number; videoWidth?: number; videoHeight?: number }
      | undefined;
    const w = img?.width || img?.videoWidth || 256;
    const h = img?.height || img?.videoHeight || 256;
    // RGBA8 (4 bytes) * 1.333 mipmap chain overhead
    const mipMultiplier = tex.generateMipmaps !== false ? 1.333 : 1.0;
    totalBytes += w * h * 4 * mipMultiplier;
  };

  if (scene.environment) accountTex(scene.environment);

  scene.traverse((obj: any) => {
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      if (!m) continue;
      accountTex(m.map);
      accountTex(m.normalMap);
      accountTex(m.roughnessMap);
      accountTex(m.metalnessMap);
      accountTex(m.aoMap);
      accountTex(m.emissiveMap);
      accountTex(m.alphaMap);
    }
  });

  return Number((totalBytes / (1024 * 1024)).toFixed(2));
}

export function pushProfilerFrame(sample: Omit<FrameSample, 'reactRendersPerSec'>): void {
  const rps = getReactRendersPerSec();
  const full: FrameSample = {
    ...sample,
    reactRendersPerSec: rps,
  };
  latestSample = full;
  frameDeltaRing[ringHead] = sample.frameDeltaMs;
  jsTimeRing[ringHead] = sample.jsMs;
  gpuTimeRing[ringHead] = sample.gpuMs;
  ringHead = (ringHead + 1) % HISTORY_LEN;
  if (ringCount < HISTORY_LEN) ringCount++;

  if (recordingActive) {
    recordedSamples.push(full);
  }
}

export function getLatestProfilerSample(): FrameSample {
  return latestSample;
}

export function getRollingHistory(): {
  length: number;
  frameMs: number[];
  jsMs: number[];
  gpuMs: number[];
} {
  const frameMs: number[] = new Array(ringCount);
  const jsMs: number[] = new Array(ringCount);
  const gpuMs: number[] = new Array(ringCount);
  const start = ringCount < HISTORY_LEN ? 0 : ringHead;
  for (let i = 0; i < ringCount; i++) {
    const idx = (start + i) % HISTORY_LEN;
    frameMs[i] = frameDeltaRing[idx];
    jsMs[i] = jsTimeRing[idx];
    gpuMs[i] = gpuTimeRing[idx];
  }
  return { length: ringCount, frameMs, jsMs, gpuMs };
}

export function startProfileRecording(): void {
  recordedSamples = [];
  recordedLongTasks = [];
  recordingStartMs = performance.now();
  recordingActive = true;
}

export function stopProfileRecording(): ProfileWindowSummary {
  recordingActive = false;
  const durationSec = Math.max(0.001, (performance.now() - recordingStartMs) / 1000);
  if (recordedSamples.length === 0) {
    return {
      sampleCount: 0,
      durationSec: Number(durationSec.toFixed(2)),
      avgFps: 0,
      avgFrameMs: latestSample.frameDeltaMs,
      p50FrameMs: latestSample.frameDeltaMs,
      p95FrameMs: latestSample.frameDeltaMs,
      p99FrameMs: latestSample.frameDeltaMs,
      maxFrameMs: latestSample.frameDeltaMs,
      avgJsMs: latestSample.jsMs,
      avgGpuMs: latestSample.gpuMs,
      avgDrawCalls: latestSample.drawCalls,
      maxDrawCalls: latestSample.drawCalls,
      avgTriangles: latestSample.triangles,
      geometries: latestSample.geometries,
      textures: latestSample.textures,
      textureMemoryMb: latestSample.textureMemoryMb,
      dpr: latestSample.dpr,
      reactRendersPerSec: getReactRendersPerSec(),
      longTaskCount: recordedLongTasks.length,
      longTaskMaxMs: recordedLongTasks.length ? Number(Math.max(...recordedLongTasks).toFixed(2)) : 0,
    };
  }

  const sortedFrames = recordedSamples.map((s) => s.frameDeltaMs).sort((a, b) => a - b);
  const n = sortedFrames.length;
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avgFrameMs = sum(sortedFrames) / n;
  const avgJsMs = sum(recordedSamples.map((s) => s.jsMs)) / n;
  const avgGpuMs = sum(recordedSamples.map((s) => s.gpuMs)) / n;
  const avgDrawCalls = sum(recordedSamples.map((s) => s.drawCalls)) / n;
  const maxDrawCalls = Math.max(...recordedSamples.map((s) => s.drawCalls));
  const avgTriangles = sum(recordedSamples.map((s) => s.triangles)) / n;
  const avgRps = sum(recordedSamples.map((s) => s.reactRendersPerSec)) / n;
  const last = recordedSamples[n - 1];

  return {
    sampleCount: n,
    durationSec: Number(durationSec.toFixed(2)),
    avgFps: Number((n / durationSec).toFixed(1)),
    avgFrameMs: Number(avgFrameMs.toFixed(2)),
    p50FrameMs: Number(sortedFrames[Math.floor(n * 0.5)].toFixed(2)),
    p95FrameMs: Number(sortedFrames[Math.min(n - 1, Math.floor(n * 0.95))].toFixed(2)),
    p99FrameMs: Number(sortedFrames[Math.min(n - 1, Math.floor(n * 0.99))].toFixed(2)),
    maxFrameMs: Number(sortedFrames[n - 1].toFixed(2)),
    avgJsMs: Number(avgJsMs.toFixed(2)),
    avgGpuMs: Number(avgGpuMs.toFixed(2)),
    avgDrawCalls: Math.round(avgDrawCalls),
    maxDrawCalls,
    avgTriangles: Math.round(avgTriangles),
    geometries: last.geometries,
    textures: last.textures,
    textureMemoryMb: last.textureMemoryMb,
    dpr: Number(last.dpr.toFixed(2)),
    reactRendersPerSec: Number(avgRps.toFixed(1)),
    longTaskCount: recordedLongTasks.length,
    longTaskMaxMs: recordedLongTasks.length ? Number(Math.max(...recordedLongTasks).toFixed(2)) : 0,
  };
}

export function getComponentRenderTotals(): Record<string, number> {
  return { ...reactRenderByComponent };
}
