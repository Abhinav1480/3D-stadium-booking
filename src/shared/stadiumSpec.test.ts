import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SEATING_DIMENSIONS,
  DEFAULT_STADIUM_SPEC,
  generateBowlRowCurvesFromSpec,
  generateSeatsFromSpec,
  computeSeatViewTelemetry,
  computeDynamicPricePaise,
  computeContiguousSeatSubTransform,
  recommendSeats,
  type SeatWithInventory,
} from './stadiumSpec';
import {
  signQrTicketToken,
  verifyQrTicketToken,
  computeRazorpaySignature,
  verifyRazorpaySignature,
  calculateRefundPaise,
} from './security';

test('S1 Real-World Dimensions & Deterministic Row Generation Along Bowl Ellipse', () => {
  const dims = DEFAULT_SEATING_DIMENSIONS;
  assert.equal(dims.seatWidthM, 0.48);
  assert.equal(dims.rowDepthM, 0.80);
  assert.equal(dims.riserHeightByTierM[1], 0.30);
  assert.equal(dims.riserHeightByTierM[2], 0.36);
  assert.equal(dims.riserHeightByTierM[3], 0.42);
  assert.equal(dims.seatCushionHeightM, 0.42);
  assert.equal(dims.seatBackrestTopHeightM, 0.85);
  assert.equal(dims.seatedEyeHeightAboveStepM, 1.15);
  assert.equal(dims.aisleWidthM, 1.20);
  assert.equal(dims.stairTreadDepthM, 0.28);
  assert.equal(dims.handrailHeightM, 1.00);
  assert.equal(dims.parapetWallHeightM, 1.10);

  const rowCurves = generateBowlRowCurvesFromSpec(DEFAULT_STADIUM_SPEC);
  assert.equal(rowCurves.length, 240, '8 stands x 3 tiers x 10 rows = 240 curved bowl rows');

  const run1 = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);
  const run2 = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);
  assert.equal(run1.length, 4800);
  assert.equal(run2.length, 4800);

  for (let i = 0; i < run1.length; i++) {
    const a = run1[i];
    const b = run2[i];
    // Strict determinism across invocations
    assert.equal(a.posX, b.posX);
    assert.equal(a.posY, b.posY);
    assert.equal(a.posZ, b.posZ);
    assert.equal(a.rotY, b.rotY);

    // Yaw jitter within +/- 0.5 deg, height jitter within +/- 0.0035 m
    assert.ok(Math.abs(a.yawJitterDeg) <= 0.5001, `Yaw jitter out of bounds: ${a.yawJitterDeg}`);
    assert.ok(Math.abs(a.heightJitterM) <= 0.0036, `Height jitter out of bounds: ${a.heightJitterM}`);

    // Cushion, backrest, and eye heights above step
    assert.ok(Math.abs(a.cushionSurfaceY - (a.posY + 0.42)) < 0.0005);
    assert.ok(Math.abs(a.backrestTopY - (a.posY + 0.85)) < 0.0005);
    assert.ok(Math.abs(a.eyePosY - (a.posY + 1.15)) < 0.0005);
  }

  // Verify tier riser steps (0.30m Tier 1, 0.36m Tier 2, 0.42m Tier 3) and 0.80m row going
  const nT1R1 = run1.find((s) => s.seatCode === 'N-T1-R01-S10')!;
  const nT1R2 = run1.find((s) => s.seatCode === 'N-T1-R02-S10')!;
  assert.ok(Math.abs((nT1R2.stepSurfaceY - nT1R1.stepSurfaceY) - 0.30) < 0.001);
  assert.ok(Math.abs((Math.abs(nT1R2.posZ) - Math.abs(nT1R1.posZ)) - 0.80) < 0.01);

  const nT2R1 = run1.find((s) => s.seatCode === 'N-T2-R01-S10')!;
  const nT2R2 = run1.find((s) => s.seatCode === 'N-T2-R02-S10')!;
  assert.ok(Math.abs((nT2R2.stepSurfaceY - nT2R1.stepSurfaceY) - 0.36) < 0.001);

  const nT3R1 = run1.find((s) => s.seatCode === 'N-T3-R01-S10')!;
  const nT3R2 = run1.find((s) => s.seatCode === 'N-T3-R02-S10')!;
  assert.ok(Math.abs((nT3R2.stepSurfaceY - nT3R1.stepSurfaceY) - 0.42) < 0.001);

  // Verify contiguous 3D seat lateral spacing along the curved row ellipse is 0.48m
  const s10Sub3 = computeContiguousSeatSubTransform(nT1R1, 3, DEFAULT_STADIUM_SPEC);
  const s10Sub4 = computeContiguousSeatSubTransform(nT1R1, 4, DEFAULT_STADIUM_SPEC);
  const lateralPitch = Math.hypot(s10Sub4.posX - s10Sub3.posX, s10Sub4.posZ - s10Sub3.posZ);
  assert.ok(Math.abs(lateralPitch - 0.48) < 0.02, `Expected ~0.48m seat pitch, got ${lateralPitch}`);

  // Verify bay anchors cover the full 42-degree stand arc without overlapping radial aisles
  const s06 = run1.find((s) => s.seatCode === 'N-T1-R01-S06')!;
  const s07 = run1.find((s) => s.seatCode === 'N-T1-R01-S07')!;
  const aisleGapM = Math.hypot(s07.posX - s06.posX, s07.posZ - s06.posZ);
  assert.ok(aisleGapM > 3.2, `Expected radial stair aisle gap between bay 6 & 7, got ${aisleGapM}`);
});

test('generateSeatsFromSpec deterministically builds 4,800 seats with valid 3D transforms and sightline scores', () => {
  const seats = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);
  assert.equal(seats.length, 4800);

  const codes = new Set<string>();
  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    assert.equal(s.instanceIndex, i);
    assert.ok(!codes.has(s.seatCode), `Duplicate seatCode ${s.seatCode}`);
    codes.add(s.seatCode);

    const groundDist = Math.hypot(s.posX, s.posZ);
    assert.ok(groundDist > 65, `Seat ${s.seatCode} too close to center: ${groundDist}`);
    assert.ok(s.posY >= 2.0 && s.posY <= 35.0, `Seat ${s.seatCode} elevation out of range: ${s.posY}`);
    assert.ok(s.viewQualityScore >= 40 && s.viewQualityScore <= 100);
  }

  const northVip = seats.find((s) => s.blockCode === 'N-T2' && s.rowNumber === 3 && s.seatNumber === 10)!;
  const eastUpper = seats.find((s) => s.blockCode === 'E-T3' && s.rowNumber === 10 && s.seatNumber === 1)!;
  assert.ok(northVip.horizontalAngleDeg < 10);
  assert.ok(northVip.viewQualityScore > eastUpper.viewQualityScore);
});

test('computeSeatViewTelemetry adjusts solar shade percentage across Day, Dusk, and Night with 1.15m eye height', () => {
  const seats = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);
  const westLowerSeat = seats.find((s) => s.blockCode === 'W-T1' && s.rowNumber === 2 && s.seatNumber === 10)!;

  const morning = computeSeatViewTelemetry(westLowerSeat, 10.0);
  const dusk = computeSeatViewTelemetry(westLowerSeat, 17.5);
  const night = computeSeatViewTelemetry(westLowerSeat, 20.5);

  assert.ok(dusk.shadePctAtTime > morning.shadePctAtTime);
  assert.equal(night.shadePctAtTime, 100);
  assert.equal(night.sunElevationDeg, 0);
  assert.ok(Math.abs(night.eyePosition[1] - (westLowerSeat.posY + 1.15)) < 0.005);
});

test('recommendSeats finds contiguous available seat groups within budget and ranks by preferences', () => {
  const rawSeats = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC).slice(0, 600);
  const inventorySeats: SeatWithInventory[] = rawSeats.map((s, idx) => ({
    ...s,
    id: idx + 1,
    status: s.seatNumber === 5 ? 'BOOKED' : 'AVAILABLE',
    pricePaise: s.categoryCode === 'VIP_LOUNGE' ? 650000 : 180000,
    categoryName: s.categoryCode,
  }));

  const recs = recommendSeats(inventorySeats, {
    budgetPerSeatPaise: 250000,
    groupSize: 3,
    preferShade: true,
    preferStraightView: true,
    preferCloseToPitch: true,
    preferFamilyZone: false,
  });

  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.equal(r.seatCodes.length, 3);
    assert.ok(r.pricePerSeatPaise <= 250000);
    assert.ok(!r.seatCodes.some((code) => code.endsWith('-S05')));
  }
});

test('QR HMAC token signing, verification, and tamper rejection', () => {
  const payload = {
    ticketCode: 'TKT-STX-9001',
    bookingReference: 'BK-STX-1001',
    matchId: 1,
    seatId: 42,
    seatCode: 'N-T2-R03-S10',
    userId: 7,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 86400_000,
  };

  const signed = signQrTicketToken(payload, 'test-secret-123');
  const verified = verifyQrTicketToken(signed, 'test-secret-123');
  assert.equal(verified.valid, true);
  assert.equal(verified.payload?.seatCode, 'N-T2-R03-S10');

  const parts = signed.split('.');
  const forged = `${parts[0]}.${parts[1]}a.${parts[2]}`;
  const forgedCheck = verifyQrTicketToken(forged, 'test-secret-123');
  assert.equal(forgedCheck.valid, false);
  assert.equal(forgedCheck.reason, 'INVALID_SIGNATURE');
});

test('Razorpay signature verification and dynamic pricing calculation', () => {
  const price = computeDynamicPricePaise(180000, {
    demand: 1.15,
    rivalry: 1.25,
    weekend: 1.1,
  });
  assert.ok(price.finalPricePaise > 180000);
  assert.equal(price.finalPricePaise % 1000, 0);

  const sig = computeRazorpaySignature('order_test_1', 'pay_test_1', 'rzp_sec');
  assert.equal(verifyRazorpaySignature('order_test_1', 'pay_test_1', sig, 'rzp_sec'), true);
  assert.equal(verifyRazorpaySignature('order_test_1', 'pay_test_2', sig, 'rzp_sec'), false);

  const fullRefund = calculateRefundPaise(
    360000,
    new Date('2026-11-10T14:00:00Z'),
    new Date('2026-11-05T14:00:00Z')
  );
  assert.equal(fullRefund.refundTier, 'FULL');
  assert.equal(fullRefund.refundAmountPaise, 360000);
});

test('concurrency: HoldLockBroker prevents double-acquiring overlapping seats across 25 simultaneous requests', async () => {
  const { holdLockBroker } = await import('../server/holdLockBroker');
  const matchId = 99;
  const targetSeatId = 1042;

  const attempts = Array.from({ length: 25 }, () =>
    holdLockBroker.acquireSeatMutexes(matchId, [targetSeatId, 1043])
  );
  const winners = attempts.filter(Boolean);
  assert.equal(winners.length, 1, 'Exactly one concurrent request must acquire the seat lock');

  holdLockBroker.releaseSeatMutexes(matchId, [targetSeatId, 1043]);
  assert.equal(holdLockBroker.acquireSeatMutexes(matchId, [targetSeatId]), true);
  holdLockBroker.releaseSeatMutexes(matchId, [targetSeatId]);
});
