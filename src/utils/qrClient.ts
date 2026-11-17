import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { jsPDF } from 'jspdf';

/**
 * Generates a crisp high-contrast PNG data URL for any QR payload.
 */
export async function generateQrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    margin: 2,
    width: 360,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#0B0F17',
      light: '#FFFFFF',
    },
  });
}

/**
 * Decodes a QR image URL or data URL using a browser HTMLCanvasElement + jsQR.
 */
export function decodeQrFromImageSrc(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const size = Math.max(240, Math.min(1024, Math.max(img.naturalWidth || 360, img.naturalHeight || 360)));
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
        const imageData = ctx.getImageData(0, 0, size, size);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        resolve(code?.data ?? null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Decodes a QR code from a user-selected PNG/JPG/WebP File object via jsQR.
 */
export async function decodeQrFromFile(file: File): Promise<string | null> {
  const objectUrl = URL.createObjectURL(file);
  try {
    return await decodeQrFromImageSrc(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Decodes a QR code from an active live video stream frame onto a reusable scratch canvas.
 */
export function decodeQrFromVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): string | null {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'dontInvert',
  });
  return decoded?.data ?? null;
}

/**
 * Triggers a clean browser PNG download of a QR image without navigating away.
 */
export function downloadQrPng(qrDataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = qrDataUrl;
  link.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export interface PdfTicketInput {
  ticket: {
    ticketCode: string;
    seatCode: string;
    standName: string;
    blockName: string;
    categoryName: string;
    rowNumber: number;
    seatNumber: number;
    status: string;
    qrDataUrl?: string;
    qrSignedToken?: string;
  };
  booking: {
    bookingReference: string;
    status: string;
    totalAmountPaise: number;
    seatCount: number;
    createdAt?: string;
  };
  match?: {
    title?: string;
    tournament?: string;
    startTime?: string;
    homeTeam?: { name?: string; shortName?: string; code?: string } | null;
    awayTeam?: { name?: string; shortName?: string; code?: string } | null;
  } | null;
  stadium?: {
    name?: string;
    city?: string;
    country?: string;
  } | null;
  payment?: {
    razorpayOrderId?: string;
    razorpayPaymentId?: string | null;
    status?: string;
  } | null;
}

/**
 * Generates and downloads a commercial match ticket PDF with an embedded high-contrast QR pass.
 */
export async function downloadTicketPdf(input: PdfTicketInput): Promise<void> {
  const { ticket, booking, match, stadium, payment } = input;
  const qrImg =
    ticket.qrDataUrl ||
    (ticket.qrSignedToken ? await generateQrDataUrl(ticket.qrSignedToken) : '');

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Dark stadium header banner
  doc.setFillColor(11, 15, 23);
  doc.rect(14, 14, 182, 34, 'F');

  // Emerald brand accent strip
  doc.setFillColor(16, 185, 129);
  doc.rect(14, 14, 4, 34, 'F');

  doc.setTextColor(16, 185, 129);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('STADIUMX OFFICIAL MATCH PASS', 24, 24);

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(match?.title || 'International Cricket Fixture', 24, 33);

  doc.setTextColor(148, 163, 184);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const venueLine = `${stadium?.name || 'STADIUMX International Oval'}, ${stadium?.city || 'Ahmedabad'}`;
  const kickoffLine = match?.startTime
    ? new Date(match.startTime).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';
  doc.text(`${match?.tournament || 'Premier Championship'}  ·  ${venueLine}  ·  ${kickoffLine}`, 24, 41);

  // Outer Ticket Card Body
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.rect(14, 52, 182, 108, 'FD');

  // Left section: Seat & Match details
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('ADMIT ONE · RESERVED DIGITAL PASS', 22, 63);

  const labelVal = (label: string, value: string, x: number, y: number) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), x, y);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(value, x, y + 5.2);
  };

  labelVal('Ticket Reference', ticket.ticketCode, 22, 74);
  labelVal('Booking Reference', booking.bookingReference, 78, 74);

  labelVal('Seat Code', ticket.seatCode, 22, 91);
  labelVal('Tier / Category', ticket.categoryName, 78, 91);

  labelVal('Stand', ticket.standName, 22, 108);
  labelVal('Block & Row', `${ticket.blockName} · Row ${ticket.rowNumber} · Seat ${ticket.seatNumber}`, 22, 125);

  labelVal('Pass Status', `${ticket.status} (${booking.status})`, 22, 142);
  const perSeatInr = Math.round(booking.totalAmountPaise / Math.max(1, booking.seatCount) / 100);
  labelVal('Seat Value / Paid', `INR ${perSeatInr.toLocaleString('en-IN')}`, 78, 142);

  // Right section: White QR Box
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(203, 213, 225);
  doc.rect(134, 62, 54, 72, 'FD');

  if (qrImg) {
    doc.addImage(qrImg, 'PNG', 139, 66, 44, 44);
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(15, 23, 42);
  doc.text('SCAN AT TURNSTILE', 161, 118, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text(ticket.ticketCode, 161, 124, { align: 'center' });
  doc.text('Single-Entry Cryptographic QR', 161, 129, { align: 'center' });

  // Payment & Venue Entry Instructions
  doc.setFillColor(241, 245, 249);
  doc.rect(14, 166, 182, 34, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('GATE ENTRY & PAYMENT SUMMARY', 20, 175);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(
    `Order Ref: ${payment?.razorpayOrderId || 'N/A'}   ·   Payment Status: ${payment?.status || 'CAPTURED'}   ·   Total Booking Paid: INR ${(
      booking.totalAmountPaise / 100
    ).toLocaleString('en-IN')}`,
    20,
    183
  );
  doc.text(
    'Present this crisp QR code at your designated stand turnstile. Passes become USED upon first valid entry.',
    20,
    190
  );

  doc.save(`STADIUMX-${ticket.ticketCode}.pdf`);
}
