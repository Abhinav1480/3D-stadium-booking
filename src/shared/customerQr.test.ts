import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectCustomerQrMatchOptions,
  extractConfirmedCustomerQrPasses,
  type CustomerBookingRecord,
} from './customerQr';

const SAMPLE_BOOKINGS: CustomerBookingRecord[] = [
  {
    booking: {
      id: 1,
      bookingReference: 'BK-STX-202601',
      matchId: 1,
      status: 'CONFIRMED',
      totalAmountPaise: 1200000,
      seatCount: 2,
    },
    match: {
      id: 1,
      title: 'India vs Australia · Super Final',
      startTime: '2026-11-22T14:00:00.000Z',
      status: 'UPCOMING',
    },
    stadium: {
      id: 1,
      name: 'STADIUMX International Oval',
      city: 'Ahmedabad',
    },
    payment: {
      status: 'CAPTURED',
      razorpayOrderId: 'order_1',
    },
    tickets: [
      {
        id: 11,
        ticketCode: 'TKT-STX-N-T2-R02-S09',
        seatId: 109,
        seatCode: 'N-T2-R02-S09',
        standName: 'North Pavilion',
        blockName: 'VIP Lounge N2',
        categoryName: 'VIP Lounge',
        rowNumber: 2,
        seatNumber: 9,
        status: 'VALID',
        qrDataUrl: 'data:image/png;base64,AAA',
      },
      {
        id: 12,
        ticketCode: 'TKT-STX-N-T2-R02-S10',
        seatId: 110,
        seatCode: 'N-T2-R02-S10',
        standName: 'North Pavilion',
        blockName: 'VIP Lounge N2',
        categoryName: 'VIP Lounge',
        rowNumber: 2,
        seatNumber: 10,
        status: 'VALID',
        qrDataUrl: 'data:image/png;base64,BBB',
      },
    ],
  },
  {
    booking: {
      id: 2,
      bookingReference: 'BK-STX-CANCELLED',
      matchId: 2,
      status: 'CANCELLED',
      totalAmountPaise: 360000,
      seatCount: 1,
    },
    match: {
      id: 2,
      title: 'India vs England · T20 Clash',
      startTime: '2026-12-01T14:00:00.000Z',
      status: 'UPCOMING',
    },
    tickets: [
      {
        id: 21,
        ticketCode: 'TKT-STX-S-T1-R01-S01',
        seatId: 501,
        seatCode: 'S-T1-R01-S01',
        standName: 'South End',
        blockName: 'South Lower',
        categoryName: 'Premium Lower',
        rowNumber: 1,
        seatNumber: 1,
        status: 'CANCELLED',
      },
    ],
  },
  {
    booking: {
      id: 3,
      bookingReference: 'BK-STX-202603',
      matchId: 3,
      status: 'CONFIRMED',
      totalAmountPaise: 450000,
      seatCount: 1,
    },
    match: {
      id: 3,
      title: 'Champions Qualifier',
      startTime: '2026-12-10T14:00:00.000Z',
      status: 'UPCOMING',
    },
    tickets: [
      {
        id: 31,
        ticketCode: 'TKT-STX-E-T1-R04-S03',
        seatId: 803,
        seatCode: 'E-T1-R04-S03',
        standName: 'East Stand',
        blockName: 'East Lower',
        categoryName: 'Club Terrace',
        rowNumber: 4,
        seatNumber: 3,
        status: 'VALID',
        qrDataUrl: 'data:image/png;base64,CCC',
      },
    ],
  },
];

test('extractConfirmedCustomerQrPasses returns only tickets from CONFIRMED bookings with metadata', () => {
  const passes = extractConfirmedCustomerQrPasses(SAMPLE_BOOKINGS);
  assert.equal(passes.length, 3);
  assert.deepEqual(
    passes.map((p) => p.ticket.seatCode),
    ['N-T2-R02-S09', 'N-T2-R02-S10', 'E-T1-R04-S03']
  );
  assert.equal(passes[0].booking.bookingReference, 'BK-STX-202601');
  assert.equal(passes[0].booking.status, 'CONFIRMED');
  assert.equal(passes[0].ticket.standName, 'North Pavilion');
  assert.equal(passes[0].ticket.seatNumber, 9);
  assert.equal(passes[0].match?.title, 'India vs Australia · Super Final');
});

test('extractConfirmedCustomerQrPasses supports filtering by specific matchId and returns empty when none exist', () => {
  const match1Only = extractConfirmedCustomerQrPasses(SAMPLE_BOOKINGS, 1);
  assert.equal(match1Only.length, 2);
  assert.ok(match1Only.every((p) => p.booking.matchId === 1));

  const empty = extractConfirmedCustomerQrPasses([SAMPLE_BOOKINGS[1]]);
  assert.equal(empty.length, 0);
});

test('collectCustomerQrMatchOptions aggregates confirmed pass counts per event', () => {
  const options = collectCustomerQrMatchOptions(SAMPLE_BOOKINGS);
  assert.deepEqual(options, [
    { matchId: 1, title: 'India vs Australia · Super Final', count: 2 },
    { matchId: 3, title: 'Champions Qualifier', count: 1 },
  ]);
});
