import type { SpatialQualityPreset } from './seatingSpatial';

const PRESET_ORDER: SpatialQualityPreset[] = ['LOW', 'MEDIUM', 'HIGH', 'ULTRA'];

export interface GovernorTransition {
  nextPreset: SpatialQualityPreset;
  reason: string;
  toastText: string;
}

export interface GovernorConfig {
  warmupDurationMs: number;
  downgradeWindowMs: number;
  upgradeWindowMs: number;
  downgradeThresholdMs: number;
  upgradeThresholdMs: number;
  downgradeCooldownMs: number;
  upgradeCooldownMs: number;
}

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  warmupDurationMs: 2000,
  downgradeWindowMs: 3000,
  upgradeWindowMs: 10000,
  downgradeThresholdMs: 20.0,
  upgradeThresholdMs: 10.0,
  downgradeCooldownMs: 6000,
  upgradeCooldownMs: 12000,
};

interface TimedSample {
  tMs: number;
  frameMs: number;
}

/**
 * Pure runtime Quality Governor state machine:
 * - Runs a 2 s warm-up benchmark during initial camera settle/render to pick starting tier
 *   (unless locked by explicit manual preset selection).
 * - Steps down 1 quality level if rolling 3 s avg frame time exceeds 20 ms.
 * - Steps up 1 quality level if rolling 10 s avg frame time stays under 10 ms.
 * - Respects manual overrides completely until reset/auto enabled.
 */
export class QualityGovernor {
  private readonly cfg: GovernorConfig;
  private preset: SpatialQualityPreset;
  private manualOverride: boolean;
  private readonly isSoftwareGl: boolean;
  private readonly samples: TimedSample[] = [];
  private warmupStartMs: number | null = null;
  private warmupCompleted = false;
  private lastTransitionMs = -Infinity;

  constructor(options: {
    initialPreset: SpatialQualityPreset;
    manualOverride?: boolean;
    isSoftwareGl?: boolean;
    config?: Partial<GovernorConfig>;
  }) {
    this.preset = options.initialPreset;
    this.manualOverride = Boolean(options.manualOverride);
    this.isSoftwareGl = Boolean(options.isSoftwareGl);
    this.cfg = { ...DEFAULT_GOVERNOR_CONFIG, ...options.config };
    if (this.manualOverride) {
      this.warmupCompleted = true;
    }
  }

  getCurrentPreset(): SpatialQualityPreset {
    return this.preset;
  }

  isManualOverride(): boolean {
    return this.manualOverride;
  }

  setManualPreset(preset: SpatialQualityPreset): void {
    this.preset = preset;
    this.manualOverride = true;
    this.warmupCompleted = true;
  }

  enableAuto(preset?: SpatialQualityPreset): void {
    if (preset) this.preset = preset;
    this.manualOverride = false;
  }

  /**
   * Records a rendered frame time (ignoring multi-second idle gaps > 250ms on demand-render pauses).
   * Returns a transition descriptor only when the preset changes.
   */
  recordFrame(timestampMs: number, frameDeltaMs: number): GovernorTransition | null {
    if (this.manualOverride) return null;

    // Ignore idle demand-loop wakeup gaps (only govern continuous active frame pacing)
    const clampedMs = Math.min(120, Math.max(1, frameDeltaMs));
    if (frameDeltaMs > 450 && this.samples.length > 0) {
      // Reset sliding window cleanly after a long idle pause so an idle sleep doesn't skew 3s avg
      this.samples.length = 0;
    }

    if (this.warmupStartMs === null) {
      this.warmupStartMs = timestampMs;
    }

    this.samples.push({ tMs: timestampMs, frameMs: clampedMs });

    const maxRetainMs = Math.max(this.cfg.upgradeWindowMs, this.cfg.warmupDurationMs) + 500;
    const pruneCutoff = timestampMs - maxRetainMs;
    while (this.samples.length > 0 && this.samples[0].tMs < pruneCutoff) {
      this.samples.shift();
    }

    // 1. Initial 2s warm-up probe
    if (!this.warmupCompleted) {
      if (timestampMs - this.warmupStartMs < this.cfg.warmupDurationMs || this.samples.length < 6) {
        return null;
      }
      this.warmupCompleted = true;
      const warmupAvg = this.averageSince(this.warmupStartMs);
      const picked = this.pickWarmupPreset(warmupAvg);
      this.samples.length = 0;
      if (picked !== this.preset) {
        const prev = this.preset;
        this.preset = picked;
        this.lastTransitionMs = timestampMs;
        return {
          nextPreset: picked,
          reason: `warmup:${warmupAvg.toFixed(1)}ms`,
          toastText: `Auto graphics set to ${picked} (${prev} → ${picked}) for smoother ${warmupAvg < 15 ? 'detail' : 'frame pacing'}.`,
        };
      }
      return null;
    }

    const idx = PRESET_ORDER.indexOf(this.preset);

    // 2. Downgrade rule: > 20 ms avg over last 3 s
    if (
      idx > 0 &&
      timestampMs - this.lastTransitionMs >= this.cfg.downgradeCooldownMs &&
      this.hasSpan(timestampMs, this.cfg.downgradeWindowMs * 0.75, 10)
    ) {
      const avg3s = this.averageSince(timestampMs - this.cfg.downgradeWindowMs);
      if (avg3s > this.cfg.downgradeThresholdMs) {
        const nextPreset = PRESET_ORDER[idx - 1];
        this.preset = nextPreset;
        this.lastTransitionMs = timestampMs;
        this.samples.length = 0;
        return {
          nextPreset,
          reason: `downgrade:${avg3s.toFixed(1)}ms`,
          toastText: `Switched graphics to ${nextPreset} to keep camera motion smooth (${avg3s.toFixed(0)} ms avg).`,
        };
      }
    }

    // 3. Upgrade rule: < 10 ms avg over full 10 s window (hardware GPU only; cap at HIGH unless already ULTRA)
    const maxAutoIdx = this.isSoftwareGl ? 1 : 2; // Up to HIGH on auto (ULTRA reserved for manual or sub-7ms hardware warmup)
    if (
      idx < maxAutoIdx &&
      timestampMs - this.lastTransitionMs >= this.cfg.upgradeCooldownMs &&
      this.hasSpan(timestampMs, this.cfg.upgradeWindowMs * 0.85, 30)
    ) {
      const avg10s = this.averageSince(timestampMs - this.cfg.upgradeWindowMs);
      if (avg10s < this.cfg.upgradeThresholdMs) {
        const nextPreset = PRESET_ORDER[idx + 1];
        this.preset = nextPreset;
        this.lastTransitionMs = timestampMs;
        this.samples.length = 0;
        return {
          nextPreset,
          reason: `upgrade:${avg10s.toFixed(1)}ms`,
          toastText: `Boosted graphics to ${nextPreset} (${avg10s.toFixed(1)} ms sustained frame time).`,
        };
      }
    }

    return null;
  }

  private pickWarmupPreset(avgMs: number): SpatialQualityPreset {
    if (this.isSoftwareGl) {
      return avgMs > 45 ? 'LOW' : 'MEDIUM';
    }
    if (avgMs < 8.5) return 'HIGH';
    if (avgMs < 15.0) return 'HIGH';
    if (avgMs < 22.0) return 'MEDIUM';
    return 'LOW';
  }

  private averageSince(cutoffMs: number): number {
    let sum = 0;
    let count = 0;
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i].tMs < cutoffMs) break;
      sum += this.samples[i].frameMs;
      count++;
    }
    return count > 0 ? sum / count : 16.67;
  }

  private hasSpan(nowMs: number, minSpanMs: number, minSamples: number): boolean {
    if (this.samples.length < minSamples) return false;
    return nowMs - this.samples[0].tMs >= minSpanMs;
  }
}

/**
 * Computes normalized mouse-wheel / trackpad zoom impulse and smooth distance-scaled step
 * bounded cleanly to [4 m, 500 m].
 */
export function normalizeWheelDelta(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  let dy = deltaY;
  if (deltaMode === 1) dy *= 32;
  else if (deltaMode === 2) dy *= 160;
  // Trackpad pinch sets ctrlKey with fine deltas
  const mult = ctrlKey ? 2.4 : 1.0;
  return Math.max(-420, Math.min(420, dy * mult));
}

export function computeSmoothedDollyTargetDist(
  currentDist: number,
  dollyFactor: number,
  minDist = 4.0,
  maxDist = 500.0
): number {
  const scaled = currentDist * dollyFactor;
  return Math.max(minDist, Math.min(maxDist, scaled));
}

export interface AdaptiveScaleState {
  scale: number;
  lastMotionMs: number;
}

/**
 * Drops active motion resolution scale to 0.75 if rolling motion frame time > 14 ms,
 * and restores 1.0 cleanly 200 ms after camera settles.
 */
export function evaluateAdaptiveMotionScale(params: {
  isMoving: boolean;
  recentFrameMs: number;
  nowMs: number;
  state: AdaptiveScaleState;
}): number {
  const { isMoving, recentFrameMs, nowMs, state } = params;
  if (isMoving) {
    state.lastMotionMs = nowMs;
    if (recentFrameMs > 14.0) {
      state.scale = 0.75;
    }
    return state.scale;
  }
  if (state.scale < 1.0 && nowMs - state.lastMotionMs >= 200) {
    state.scale = 1.0;
  }
  return state.scale;
}
