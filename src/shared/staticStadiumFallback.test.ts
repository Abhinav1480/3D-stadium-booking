import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STADIUM_SPEC, generateSeatsFromSpec } from './stadiumSpec';
import { buildDeterministicStaticStadiumBundle } from './staticStadiumFallback';

test('Deterministic static fallback produces exact 4,800 anchors matching DEFAULT_STADIUM_SPEC', () => {
  const bundle = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC);
  const generated = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);

  assert.equal(bundle.stadium.capacity, 4800);
  assert.equal(bundle.categories.length, 5);
  assert.equal(bundle.stands.length, 8);
  assert.equal(bundle.blocks.length, 24);
  assert.equal(bundle.seats.length, 4800);
  assert.equal(bundle.defaultMatches.length, 3);

  const seenIds = new Set<number>();
  const seenCodes = new Set<string>();
  const validStandIds = new Set(bundle.stands.map((s) => s.id));
  const validBlockIds = new Set(bundle.blocks.map((b) => b.id));
  const validCategoryIds = new Set(bundle.categories.map((c) => c.id));

  for (let i = 0; i < bundle.seats.length; i++) {
    const seat = bundle.seats[i];
    const specSeat = generated[i];

    assert.equal(seat.id, specSeat.instanceIndex + 1);
    assert.equal(seat.seatCode, specSeat.seatCode);
    assert.equal(seat.posX, specSeat.posX);
    assert.equal(seat.posY, specSeat.posY);
    assert.equal(seat.posZ, specSeat.posZ);
    assert.equal(seat.rotY, specSeat.rotY);

    assert.ok(!seenIds.has(seat.id), `Duplicate seat id ${seat.id}`);
    assert.ok(!seenCodes.has(seat.seatCode), `Duplicate seatCode ${seat.seatCode}`);
    seenIds.add(seat.id);
    seenCodes.add(seat.seatCode);

    assert.ok(validStandIds.has(seat.standId), `Invalid standId ${seat.standId}`);
    assert.ok(validBlockIds.has(seat.blockId), `Invalid blockId ${seat.blockId}`);
    assert.ok(validCategoryIds.has(seat.categoryId), `Invalid categoryId ${seat.categoryId}`);
  }

  const snap1 = bundle.getMatchInventorySnapshot(1);
  assert.equal(snap1.matchId, 1);
  assert.equal(snap1.inventory.length, 4800);
  assert.equal(snap1.pricing.length, 5);
  assert.ok(snap1.inventory.some((item) => item.status === 'AVAILABLE'));
  assert.ok(snap1.inventory.some((item) => item.status === 'BOOKED'));
  assert.ok(snap1.inventory.some((item) => item.status === 'BLOCKED'));
});
