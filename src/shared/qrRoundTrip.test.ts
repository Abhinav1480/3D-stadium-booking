import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  calculateRefundPaise,
  signQrTicketToken,
  verifyQrTicketToken,
} from './security';

/**
 * Minimal pure-Node PNG RGBA decoder (supports 8-bit color types 0, 2, 3, 6)
 * to perform real pixel-level QR round-trip verification via jsQR.
 */
function decodePngToRgba(buf: Buffer): { width: number; height: number; data: Uint8ClampedArray } {
  let offset = 8; // skip PNG signature
  let width = 0;
  let height = 0;
  let colorType = 6;
  let palette: Buffer | null = null;
  const idatChunks: Buffer[] = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('ascii');
    const chunkData = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      colorType = chunkData[9];
    } else if (type === 'PLTE') {
      palette = chunkData;
    } else if (type === 'IDAT') {
      idatChunks.push(chunkData);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const recon = Buffer.alloc(height * stride);

  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };

  for (let y = 0; y < height; y++) {
    const rowIn = y * (stride + 1);
    const filter = raw[rowIn];
    const rowOut = y * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[rowIn + 1 + x];
      const left = x >= bpp ? recon[rowOut + x - bpp] : 0;
      const up = y > 0 ? recon[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? recon[(y - 1) * stride + x - bpp] : 0;
      let decoded = val;
      if (filter === 1) decoded = (val + left) & 0xff;
      else if (filter === 2) decoded = (val + up) & 0xff;
      else if (filter === 3) decoded = (val + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) decoded = (val + paeth(left, up, upLeft)) & 0xff;
      recon[rowOut + x] = decoded;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colorType === 6) {
      rgba[i * 4] = recon[i * 4];
      rgba[i * 4 + 1] = recon[i * 4 + 1];
      rgba[i * 4 + 2] = recon[i * 4 + 2];
      rgba[i * 4 + 3] = recon[i * 4 + 3];
    } else if (colorType === 2) {
      rgba[i * 4] = recon[i * 3];
      rgba[i * 4 + 1] = recon[i * 3 + 1];
      rgba[i * 4 + 2] = recon[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    } else if (colorType === 3 && palette) {
      const idx = recon[i];
      rgba[i * 4] = palette[idx * 3] ?? 255;
      rgba[i * 4 + 1] = palette[idx * 3 + 1] ?? 255;
      rgba[i * 4 + 2] = palette[idx * 3 + 2] ?? 255;
      rgba[i * 4 + 3] = 255;
    } else {
      const g = recon[i];
      rgba[i * 4] = g;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = g;
      rgba[i * 4 + 3] = 255;
    }
  }

  return { width, height, data: rgba };
}

test('QR image encode -> pixel decode round-trip reproduces signed ticket token & passes cryptographic check', async () => {
  const token = signQrTicketToken({
    ticketCode: 'TKT-ROUNDTRIP-001',
    bookingReference: 'STX-TEST-REF',
    matchId: 1,
    seatId: 42,
    seatCode: 'N-T1-R03-S02',
    userId: 7,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 3600_000,
  });

  const pngBuffer = await QRCode.toBuffer(token, {
    margin: 2,
    width: 320,
    errorCorrectionLevel: 'M',
    color: { dark: '#0B0F17', light: '#FFFFFF' },
  });

  const decodedPng = decodePngToRgba(pngBuffer);
  const qrResult = jsQR(decodedPng.data, decodedPng.width, decodedPng.height);
  assert.ok(qrResult, 'jsQR must decode the generated PNG QR image cleanly');
  assert.equal(qrResult.data, token, 'Decoded QR payload must match signed token byte-for-byte');

  const verified = verifyQrTicketToken(qrResult.data);
  assert.equal(verified.valid, true);
  assert.equal(verified.payload?.ticketCode, 'TKT-ROUNDTRIP-001');
  assert.equal(verified.payload?.seatCode, 'N-T1-R03-S02');
});

test('QR token verification rejects forged, malformed, and expired tokens cleanly', () => {
  const expired = signQrTicketToken({
    ticketCode: 'TKT-EXP-001',
    bookingReference: 'STX-EXP',
    matchId: 1,
    seatId: 10,
    seatCode: 'N-T1-R01-S10',
    userId: 1,
    issuedAt: Date.now() - 10_000_000,
    expiresAt: Date.now() - 1000,
  });
  const expCheck = verifyQrTicketToken(expired);
  assert.equal(expCheck.valid, false);
  assert.equal(expCheck.reason, 'TOKEN_EXPIRED');

  const forged = verifyQrTicketToken(`${expired.slice(0, -6)}AAAAAA`);
  assert.equal(forged.valid, false);
  assert.equal(forged.reason, 'INVALID_SIGNATURE');

  const malformed = verifyQrTicketToken('NOT-A-VALID-TOKEN');
  assert.equal(malformed.valid, false);
  assert.equal(malformed.reason, 'MALFORMED_TOKEN_FORMAT');
});

test('calculateRefundPaise applies FULL, PARTIAL, and NON_REFUNDABLE policy tiers accurately', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const fullMatch = new Date(now.getTime() + 72 * 3600 * 1000);
  const partialMatch = new Date(now.getTime() + 12 * 3600 * 1000);
  const lastMinuteMatch = new Date(now.getTime() + 2 * 3600 * 1000);

  assert.deepEqual(calculateRefundPaise(500000, fullMatch, now), {
    refundAmountPaise: 500000,
    refundTier: 'FULL',
  });
  assert.deepEqual(calculateRefundPaise(500000, partialMatch, now), {
    refundAmountPaise: 350000,
    refundTier: 'PARTIAL',
  });
  assert.deepEqual(calculateRefundPaise(500000, lastMinuteMatch, now), {
    refundAmountPaise: 0,
    refundTier: 'NON_REFUNDABLE',
  });
});
