import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_STADIUM_SPEC,
  SEAT_SUB_INSTANCES_PER_ANCHOR,
  generateSeatsFromSpec,
  recommendSeats,
  type SeatWithInventory,
} from './stadiumSpec';
import {
  QUALITY_PRESET_CONFIGS,
  buildSpatialSeatingIndex,
  clampStadiumCameraPosition,
  computeSeatViewCamera,
  computeSeatVisualHex,
  computeStandFocusCamera,
  detectRecommendedQualityPreset,
  estimateStadiumSurfaceY,
  intersectStadiumCursorRay,
  resolveSeatAvailabilityStatus,
  selectChunkLod,
} from './seatingSpatial';

test('buildSpatialSeatingIndex partitions all 33,600 seats cleanly across 24 chunks (8 stands x 3 tiers)', () => {
  const generated = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);
  const inputSeats = generated.map((s, idx) => ({
    ...s,
    id: idx + 1,
    categoryId: 1,
    isCovered: s.tier >= 2,
  }));

  const index = buildSpatialSeatingIndex(inputSeats, DEFAULT_STADIUM_SPEC);
  assert.equal(index.chunks.length, 24, 'Must partition into exactly 24 stand x tier chunks');
  assert.equal(
    index.totalSubInstances,
    4800 * SEAT_SUB_INSTANCES_PER_ANCHOR,
    'Must preserve all 33,600 individual 3D seats'
  );
  assert.equal(index.anchorSlotByInstanceIndex.length, 4800);

  for (const chunk of index.chunks) {
    assert.equal(chunk.seats.length, 1400, `Chunk ${chunk.blockCode} must hold 1,400 3D seats`);
    assert.ok(chunk.boundingSphere.radius > 10 && chunk.boundingSphere.radius < 45);
    for (const s of chunk.seats) {
      const dist = Math.hypot(
        s.posX - chunk.boundingSphere.centerX,
        s.posY + 0.45 - chunk.boundingSphere.centerY,
        s.posZ - chunk.boundingSphere.centerZ
      );
      assert.ok(
        dist <= chunk.boundingSphere.radius + 0.01,
        `Seat ${s.seatCode} falls outside chunk sphere`
      );
    }
  }
});

test('selectChunkLod picks lean LOD2/LOD3 on software WebGL and full LOD1..3 progression on hardware GPU', () => {
  const northSphere = { centerX: 0, centerY: 10, centerZ: -89, radius: 22 };

  // Software GL: close chunk uses LOD2, 137m chunk uses LOD3, >150m opposite chunk uses ROW_STRIP
  assert.equal(selectChunkLod(0, 12, -50, northSphere, 'HIGH', true), 'LOD2');
  assert.equal(selectChunkLod(0, 12, 70, northSphere, 'HIGH', true), 'LOD3');
  assert.equal(selectChunkLod(0, 12, 95, northSphere, 'HIGH', true), 'ROW_STRIP');
  assert.equal(selectChunkLod(0, 12, -50, northSphere, 'LOW', true), 'LOD3');

  // Hardware GPU HIGH preset: near chunk uses LOD1, mid uses LOD2, far (137m) uses LOD3, >150m uses ROW_STRIP
  assert.equal(selectChunkLod(0, 12, -45, northSphere, 'HIGH', false), 'LOD1');
  assert.equal(selectChunkLod(0, 12, 10, northSphere, 'HIGH', false), 'LOD2');
  assert.equal(selectChunkLod(0, 12, 70, northSphere, 'HIGH', false), 'LOD3');
  assert.equal(selectChunkLod(0, 12, 95, northSphere, 'HIGH', false), 'ROW_STRIP');
});

test('computeStandFocusCamera and computeSeatViewCamera frame stands and pitch clearly', () => {
  const northStand = DEFAULT_STADIUM_SPEC.stands.find((s) => s.code === 'NORTH')!;
  const northCam = computeStandFocusCamera(northStand, null);
  assert.ok(northCam.position[2] < 0 && northCam.position[2] > -40);
  assert.ok(northCam.target[2] < -75);

  const seatCam = computeSeatViewCamera({ posX: 0, posY: 8.92, posZ: -87.2 }, 0, 0);
  assert.ok(Math.abs(seatCam.position[1] - 10.07) < 0.001);
  // Looking south toward pitch (+Z relative to North seat) and downward (-Y)
  assert.ok(seatCam.lookAt[2] > seatCam.position[2]);
  assert.ok(seatCam.lookAt[1] < seatCam.position[1]);
});

test('computeSeatVisualHex preserves architectural colors and highlights hovered/selected anchors', () => {
  const base = {
    categoryCode: 'VIP_LOUNGE',
    tier: 2,
    rowNumber: 3,
    seatNumber: 10,
    subIdx: 3,
    isCenterAnchor: true,
    globalInstanceIndex: 100,
  };
  const hovered = computeSeatVisualHex({
    seat: base,
    status: 'AVAILABLE',
    isHovered: true,
    isSelected: false,
    isFocused: false,
    matchesFilter: true,
  });
  assert.equal(hovered.hex, '#FFFFFF');
  assert.ok(hovered.scale > 1.1);

  const dimmed = computeSeatVisualHex({
    seat: base,
    status: 'AVAILABLE',
    isHovered: false,
    isSelected: false,
    isFocused: false,
    matchesFilter: false,
  });
  // Keep gentle dim >= 0.50 rather than crushing bowl into near-black 0.24
  assert.ok(dimmed.brightnessMultiplier >= 0.5);
});

test('estimateStadiumSurfaceY and clampStadiumCameraPosition prevent floor & roof clipping', () => {
  // Pitch center is flat ~0.05m
  assert.ok(estimateStadiumSurfaceY(0, 0) < 0.2);
  // North Tier 1 (~76..83m), Tier 2 (~86..93m), Tier 3 (~95..103m)
  const t1Y = estimateStadiumSurfaceY(0, -78);
  const t2Y = estimateStadiumSurfaceY(0, -88);
  const t3Y = estimateStadiumSurfaceY(0, -98);
  assert.ok(t1Y >= 2.1 && t1Y <= 5.5, `Expected T1 surface ~2-5m, got ${t1Y}`);
  assert.ok(t2Y >= 8.0 && t2Y <= 12.0, `Expected T2 surface ~8-12m, got ${t2Y}`);
  assert.ok(t3Y >= 15.0 && t3Y <= 19.5, `Expected T3 surface ~15-19m, got ${t3Y}`);

  // Floor clamp prevents sinking beneath turf or Tier 2 steps
  const [, turfClampedY] = clampStadiumCameraPosition(0, -4, 0);
  assert.ok(turfClampedY >= 1.45, 'Must stay above pitch turf');
  const [, tierClampedY] = clampStadiumCameraPosition(0, 4.0, -88);
  assert.ok(tierClampedY >= t2Y + 1.4, 'Must stay above Tier 2 concrete risers');

  // Roof slab clamp pushes out of [27.2..32.6m] canopy annulus
  const [, roofAboveY] = clampStadiumCameraPosition(0, 29.8, -96, 36.0, 34.0);
  assert.ok(roofAboveY >= 32.5, `Coming from above should clear top of roof: ${roofAboveY}`);
  const [, roofBelowY] = clampStadiumCameraPosition(0, 29.8, -96, 22.0, 14.0);
  assert.ok(roofBelowY <= 27.3, `Coming from below should clear under roof soffit: ${roofBelowY}`);
});

test('intersectStadiumCursorRay hits pitch and North Stand bowl cleanly for cursor-centered zoom', () => {
  // Ray from aerial camera (0, 56, 86) straight toward pitch center (0, 0, 0)
  const lenPitch = Math.hypot(0, -56, -86);
  const hitPitch = intersectStadiumCursorRay(0, 56, 86, 0, -56 / lenPitch, -86 / lenPitch, 100);
  assert.equal(hitPitch.hitSurface, true);
  assert.ok(Math.hypot(hitPitch.x, hitPitch.z) < 5.0);
  assert.ok(hitPitch.y < 1.0);

  // Ray from aerial camera (0, 56, 86) aimed at North Tier 2 (0, 9.8, -89)
  const dx = 0;
  const dy = 9.8 - 56;
  const dz = -89 - 86;
  const lenNorth = Math.hypot(dx, dy, dz);
  const hitNorth = intersectStadiumCursorRay(
    0,
    56,
    86,
    dx / lenNorth,
    dy / lenNorth,
    dz / lenNorth,
    180
  );
  assert.equal(hitNorth.hitSurface, true);
  assert.ok(hitNorth.z < -75 && hitNorth.y > 5.0, `Expected North bowl hit, got (${hitNorth.x}, ${hitNorth.y}, ${hitNorth.z})`);
});

test('QUALITY_PRESET_CONFIGS and detectRecommendedQualityPreset scale all dimensions cleanly', () => {
  assert.equal(QUALITY_PRESET_CONFIGS.LOW.shadowsEnabled, false);
  assert.equal(QUALITY_PRESET_CONFIGS.LOW.useSimpleSeatMaterial, true);
  assert.equal(QUALITY_PRESET_CONFIGS.LOW.maxCrowd, 0);
  assert.equal(QUALITY_PRESET_CONFIGS.LOW.bloomEnabled, false);
  assert.equal(QUALITY_PRESET_CONFIGS.LOW.macroDetailEnabled, false);

  assert.equal(QUALITY_PRESET_CONFIGS.MEDIUM.shadowMapSize, 1024);
  assert.equal(QUALITY_PRESET_CONFIGS.HIGH.shadowMapSize, 2048);
  assert.equal(QUALITY_PRESET_CONFIGS.HIGH.bloomEnabled, true);
  assert.ok(QUALITY_PRESET_CONFIGS.ULTRA.maxCrowd > QUALITY_PRESET_CONFIGS.HIGH.maxCrowd);
  assert.ok(QUALITY_PRESET_CONFIGS.ULTRA.maxDpr > QUALITY_PRESET_CONFIGS.LOW.maxDpr);

  assert.equal(detectRecommendedQualityPreset({ isSoftwareGl: false, viewportWidth: 390, hardwareConcurrency: 4 }), 'LOW');
  assert.equal(detectRecommendedQualityPreset({ isSoftwareGl: true, viewportWidth: 1440, hardwareConcurrency: 8 }), 'MEDIUM');
  assert.equal(detectRecommendedQualityPreset({ isSoftwareGl: false, viewportWidth: 1440, hardwareConcurrency: 8, deviceMemory: 8 }), 'HIGH');
});

test('resolveSeatAvailabilityStatus distinguishes all 6 seat statuses and computes live countdown', () => {
  const now = 1_700_000_000_000;
  const exp = new Date(now + 125_000).toISOString();

  assert.equal(resolveSeatAvailabilityStatus({ rawStatus: 'AVAILABLE', isSelected: false }).shaderStateCode, 0);
  assert.equal(resolveSeatAvailabilityStatus({ rawStatus: 'BOOKED', isSelected: true }).shaderStateCode, 1);
  assert.equal(resolveSeatAvailabilityStatus({ rawStatus: 'AVAILABLE', isSelected: true }).shaderStateCode, 3);
  assert.equal(resolveSeatAvailabilityStatus({ rawStatus: 'BLOCKED', isSelected: false }).shaderStateCode, 4);

  const heldOther = resolveSeatAvailabilityStatus({
    rawStatus: 'HELD',
    holdUserId: 2,
    holdToken: 'HOLD-OTHER',
    holdExpiresAt: exp,
    currentUserId: 1,
    activeHoldToken: 'HOLD-MINE',
    isSelected: false,
    nowMs: now,
  });
  assert.equal(heldOther.effectiveStatus, 'HELD');
  assert.equal(heldOther.shaderStateCode, 2);
  assert.equal(heldOther.remainingSec, 125);

  const heldMine = resolveSeatAvailabilityStatus({
    rawStatus: 'HELD',
    holdUserId: 1,
    holdToken: 'HOLD-MINE',
    holdExpiresAt: exp,
    currentUserId: 1,
    activeHoldToken: 'HOLD-OTHER',
    isSelected: false,
    nowMs: now,
  });
  assert.equal(heldMine.effectiveStatus, 'HELD_BY_CURRENT_USER');
  assert.equal(heldMine.shaderStateCode, 5);
  assert.equal(heldMine.label, 'Reserved for You');
  assert.equal(heldMine.remainingSec, 125);
});

test('recommendSeats filters by stand, category, adjacent toggle, and supports deterministic sorting', () => {
  const generated = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);
  const enriched: SeatWithInventory[] = generated.map((s, idx) => ({
    ...s,
    id: idx + 1,
    status: s.seatNumber % 2 === 0 ? 'BOOKED' : 'AVAILABLE',
    categoryName: s.categoryCode,
    pricePaise: s.tier === 1 ? 350000 : s.tier === 2 ? 700000 : 180000,
  }));

  // Even seats booked => no 2-seat adjacent pair exists, so requireAdjacentSeats=true yields 0
  const adjOnly = recommendSeats(
    enriched,
    {
      budgetPerSeatPaise: 800000,
      groupSize: 2,
      preferredStandCode: 'NORTH',
      preferShade: true,
      preferStraightView: true,
      preferCloseToPitch: false,
      preferFamilyZone: false,
      requireAdjacentSeats: true,
    },
    6
  );
  assert.equal(adjOnly.length, 0);

  // Disabling seats-together allows top non-adjacent groups in NORTH
  const flexNorth = recommendSeats(
    enriched,
    {
      budgetPerSeatPaise: 800000,
      groupSize: 2,
      preferredStandCode: 'NORTH',
      preferShade: true,
      preferStraightView: true,
      preferCloseToPitch: false,
      preferFamilyZone: false,
      requireAdjacentSeats: false,
      sortBy: 'PRICE_ASC',
    },
    6
  );
  assert.ok(flexNorth.length > 0);
  assert.ok(flexNorth.every((g) => g.standCode === 'NORTH' && g.seatsTogether === false));
  for (let i = 1; i < flexNorth.length; i++) {
    assert.ok(flexNorth[i].pricePerSeatPaise >= flexNorth[i - 1].pricePerSeatPaise);
  }
});
