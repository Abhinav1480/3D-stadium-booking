export interface CustomerBookingRecord {
  booking: {
    id: number;
    bookingReference: string;
    matchId: number;
    status: string;
    totalAmountPaise: number;
    refundAmountPaise?: number;
    seatCount: number;
    createdAt?: string;
  };
  match?: {
    id?: number;
    title?: string;
    tournament?: string;
    startTime?: string;
    status?: string;
    homeTeam?: {
      code?: string;
      name?: string;
      shortName?: string;
      primaryColor?: string;
      secondaryColor?: string;
    } | null;
    awayTeam?: {
      code?: string;
      name?: string;
      shortName?: string;
      primaryColor?: string;
      secondaryColor?: string;
    } | null;
  } | null;
  stadium?: {
    id?: number;
    name?: string;
    city?: string;
    country?: string;
  } | null;
  payment?: {
    razorpayOrderId?: string;
    razorpayPaymentId?: string | null;
    status?: string;
  } | null;
  tickets?: Array<{
    id: number;
    ticketCode: string;
    seatId: number;
    seatCode: string;
    standName: string;
    blockName: string;
    categoryName: string;
    rowNumber: number;
    seatNumber: number;
    status: string;
    qrDataUrl?: string;
    qrSignedToken?: string;
    scannedAt?: string | null;
    createdAt?: string;
  }>;
}

export interface CustomerQrPassItem {
  id: string;
  ticket: NonNullable<CustomerBookingRecord['tickets']>[number];
  booking: CustomerBookingRecord['booking'];
  match: CustomerBookingRecord['match'];
  stadium: CustomerBookingRecord['stadium'];
  payment: CustomerBookingRecord['payment'];
}

export interface CustomerQrMatchOption {
  matchId: number;
  title: string;
  count: number;
}

/**
 * Extracts individual QR pass items strictly from CONFIRMED customer bookings.
 * Cancelled or refunded bookings are excluded from the active My QR wallet.
 */
export function extractConfirmedCustomerQrPasses(
  bookings: CustomerBookingRecord[],
  matchFilterId: number | 'ALL' = 'ALL'
): CustomerQrPassItem[] {
  const passes: CustomerQrPassItem[] = [];

  for (const item of bookings) {
    const bookingStatus = String(item.booking?.status || '').toUpperCase();
    if (bookingStatus !== 'CONFIRMED') continue;

    if (matchFilterId !== 'ALL' && item.booking.matchId !== matchFilterId) {
      continue;
    }

    const ticketList = item.tickets || [];
    for (const ticket of ticketList) {
      const tStatus = String(ticket.status || '').toUpperCase();
      if (tStatus === 'CANCELLED') continue;

      passes.push({
        id: `${item.booking.id}-${ticket.id}-${ticket.ticketCode}`,
        ticket,
        booking: item.booking,
        match: item.match ?? null,
        stadium: item.stadium ?? null,
        payment: item.payment ?? null,
      });
    }
  }

  return passes;
}

/**
 * Collects distinct matches present in confirmed QR passes for optional customer filtering.
 */
export function collectCustomerQrMatchOptions(
  bookings: CustomerBookingRecord[]
): CustomerQrMatchOption[] {
  const map = new Map<number, CustomerQrMatchOption>();
  const confirmed = extractConfirmedCustomerQrPasses(bookings, 'ALL');

  for (const pass of confirmed) {
    const mId = pass.booking.matchId;
    const existing = map.get(mId);
    if (existing) {
      existing.count += 1;
    } else {
      map.set(mId, {
        matchId: mId,
        title: pass.match?.title || `Match #${mId}`,
        count: 1,
      });
    }
  }

  return Array.from(map.values());
}
