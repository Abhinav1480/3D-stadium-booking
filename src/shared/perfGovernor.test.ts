import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QualityGovernor,
  computeSmoothedDollyTargetDist,
  evaluateAdaptiveMotionScale,
  normalizeWheelDelta,
} from './perfGovernor';
import {
  isChunkBehindCamera,
  selectChunkLodWithHysteresis,
} from './seatingSpatial';

test('selectChunkLodWithHysteresis applies 10% hysteresis and switches to ROW_STRIP beyond 150 m', () => {
  const northSphere = { centerX: 0, centerY: 10, centerZ: -89, radius: 22 };

  // Distance to center at z = 95 => ~184 m, surfaceDist ~162 m (> 150 m) => ROW_STRIP
  assert.equal(
    selectChunkLodWithHysteresis(0, 12, 95, northSphere, null, 'HIGH', false),
    'ROW_STRIP'
  );

  // Hysteresis keeps ROW_STRIP until moving closer than 150 * 0.9 = 135 m surfaceDist
  // z = 75 => dist 164 => surfaceDist 142 m (between 135 and 150) => stays ROW_STRIP
  assert.equal(
    selectChunkLodWithHysteresis(0, 12, 75, northSphere, 'ROW_STRIP', 'HIGH', false),
    'ROW_STRIP'
  );

  // Coming from LOD3 outward: stays LOD3 until > 150 * 1.1 = 165 m surfaceDist
  assert.equal(
    selectChunkLodWithHysteresis(0, 12, 85, northSphere, 'LOD3', 'HIGH', false),
    'LOD3'
  );

  // LOD1 -> LOD2 hysteresis on HIGH (threshold 25 m -> 27.5 m out, 22.5 m in)
  // surfaceDist = 26 m when prev was LOD1 => stays LOD1
  assert.equal(
    selectChunkLodWithHysteresis(0, 10, -41, northSphere, 'LOD1', 'HIGH', false),
    'LOD1'
  );
  // surfaceDist = 26 m when prev was LOD2 => stays LOD2
  assert.equal(
    selectChunkLodWithHysteresis(0, 10, -41, northSphere, 'LOD2', 'HIGH', false),
    'LOD2'
  );
});

test('isChunkBehindCamera culls chunks behind view plane and keeps forward/overlapping chunks', () => {
  const southSphere = { centerX: 0, centerY: 10, centerZ: 89, radius: 20 };
  // Camera at (0, 20, 40) looking North (0, 0, -1): South chunk is +49 m behind camera
  assert.equal(
    isChunkBehindCamera(0, 20, 40, 0, 0, -1, southSphere),
    true
  );

  // Camera at (0, 56, 86) looking toward (0, 4, -8): dir normalized ~ (0, -0.48, -0.87)
  // South chunk is close below/around camera sphere, Wait: forwardProj = (0-0)*0 + (10-56)*(-0.48) + (89-86)*(-0.87) = +22 - 2.6 = +19.4 => visible!
  assert.equal(
    isChunkBehindCamera(0, 56, 86, 0, -0.48, -0.87, southSphere),
    false
  );
});

test('QualityGovernor steps down after 3s >20ms, steps up after 10s <10ms, and respects manual override', () => {
  const gov = new QualityGovernor({
    initialPreset: 'HIGH',
    isSoftwareGl: false,
  });

  // 2s warmup with 12ms frames stays HIGH
  for (let t = 0; t <= 2200; t += 100) {
    gov.recordFrame(t, 12);
  }
  assert.equal(gov.getCurrentPreset(), 'HIGH');

  // Sustained > 25 ms over 3.2s => steps down HIGH -> MEDIUM
  let transition = null;
  for (let t = 2300; t <= 5600; t += 100) {
    const res = gov.recordFrame(t, 26);
    if (res) transition = res;
  }
  assert.ok(transition !== null);
  assert.equal(transition!.nextPreset, 'MEDIUM');
  assert.equal(gov.getCurrentPreset(), 'MEDIUM');

  // Sustained < 7 ms over 10s after cooldown => steps up MEDIUM -> HIGH
  let upTransition = null;
  for (let t = 6000; t <= 19000; t += 100) {
    const res = gov.recordFrame(t, 6.5);
    if (res) upTransition = res;
  }
  assert.ok(upTransition !== null);
  assert.equal(upTransition!.nextPreset, 'HIGH');

  // Manual override prevents automatic stepping even under heavy frames
  gov.setManualPreset('ULTRA');
  for (let t = 20000; t <= 26000; t += 100) {
    assert.equal(gov.recordFrame(t, 42), null);
  }
  assert.equal(gov.getCurrentPreset(), 'ULTRA');
});

test('Adaptive resolution and dolly zoom helpers maintain 4m..500m and 0.75 motion scaling', () => {
  assert.equal(computeSmoothedDollyTargetDist(5, 0.5, 4, 500), 4);
  assert.equal(computeSmoothedDollyTargetDist(450, 1.4, 4, 500), 500);
  assert.ok(Math.abs(normalizeWheelDelta(3, 1, false) - 96) < 0.01);

  const state = { scale: 1.0, lastMotionMs: 0 };
  assert.equal(
    evaluateAdaptiveMotionScale({ isMoving: true, recentFrameMs: 18, nowMs: 1000, state }),
    0.75
  );
  // Not settled long enough (150ms < 200ms)
  assert.equal(
    evaluateAdaptiveMotionScale({ isMoving: false, recentFrameMs: 8, nowMs: 1150, state }),
    0.75
  );
  // Restores 1.0 after 200ms settle
  assert.equal(
    evaluateAdaptiveMotionScale({ isMoving: false, recentFrameMs: 8, nowMs: 1250, state }),
    1.0
  );
});
