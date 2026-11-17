import crypto from 'node:crypto';

export interface SignedTicketPayload {
  ticketCode: string;
  bookingReference: string;
  matchId: number;
  seatId: number;
  seatCode: string;
  userId: number;
  issuedAt: number;
  expiresAt: number;
}

const DEFAULT_QR_SECRET =
  process.env.QR_HMAC_SECRET || 'stadiumx-qr-hmac-secret-key-2026';
const DEFAULT_RAZORPAY_SECRET =
  process.env.RAZORPAY_KEY_SECRET || 'rzp_test_stadiumx_webhook_secret';

export function signQrTicketToken(
  payload: SignedTicketPayload,
  secret = DEFAULT_QR_SECRET
): string {
  const json = JSON.stringify(payload);
  const encodedPayload = Buffer.from(json, 'utf8').toString('base64url');
  const hmac = crypto
    .createHmac('sha256', secret)
    .update(`STX1.${encodedPayload}`)
    .digest('base64url');
  return `STX1.${encodedPayload}.${hmac}`;
}

export function verifyQrTicketToken(
  token: string,
  secret = DEFAULT_QR_SECRET
): { valid: boolean; reason?: string; payload?: SignedTicketPayload } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'EMPTY_TOKEN' };
  }
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'STX1') {
    return { valid: false, reason: 'MALFORMED_TOKEN_FORMAT' };
  }

  const [, encodedPayload, providedHmac] = parts;
  const expectedHmac = crypto
    .createHmac('sha256', secret)
    .update(`STX1.${encodedPayload}`)
    .digest('base64url');

  const a = Buffer.from(providedHmac);
  const b = Buffer.from(expectedHmac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as SignedTicketPayload;
    if (!decoded.ticketCode || !decoded.matchId || !decoded.seatId) {
      return { valid: false, reason: 'INVALID_PAYLOAD_FIELDS' };
    }
    if (decoded.expiresAt && Date.now() > decoded.expiresAt) {
      return { valid: false, reason: 'TOKEN_EXPIRED', payload: decoded };
    }
    return { valid: true, payload: decoded };
  } catch {
    return { valid: false, reason: 'CORRUPT_PAYLOAD_JSON' };
  }
}

export function computeRazorpaySignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  secret = DEFAULT_RAZORPAY_SECRET
): string {
  return crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
}

export function verifyRazorpaySignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
  secret = DEFAULT_RAZORPAY_SECRET
): boolean {
  if (!razorpayOrderId || !razorpayPaymentId || !signature) return false;
  const expected = computeRazorpaySignature(razorpayOrderId, razorpayPaymentId, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function calculateRefundPaise(
  totalAmountPaise: number,
  matchStartTime: Date,
  now: Date,
  policy: { fullRefundHoursBefore: number; partialRefundPct: number } = {
    fullRefundHoursBefore: 48,
    partialRefundPct: 70,
  }
): { refundAmountPaise: number; refundTier: 'FULL' | 'PARTIAL' | 'NON_REFUNDABLE' } {
  const hoursUntilMatch = (matchStartTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilMatch >= policy.fullRefundHoursBefore) {
    return { refundAmountPaise: totalAmountPaise, refundTier: 'FULL' };
  }
  if (hoursUntilMatch >= 4) {
    const refundAmountPaise = Math.round((totalAmountPaise * policy.partialRefundPct) / 100);
    return { refundAmountPaise, refundTier: 'PARTIAL' };
  }
  return { refundAmountPaise: 0, refundTier: 'NON_REFUNDABLE' };
}
