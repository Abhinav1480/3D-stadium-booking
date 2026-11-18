import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Download,
  Eye,
  FileDown,
  MapPin,
  Maximize2,
  QrCode,
  Receipt,
  Share2,
  Ticket,
  X,
} from 'lucide-react';
import { useStadiumStore } from '../store/useStadiumStore';
import { downloadQrPng, downloadTicketPdf } from '../utils/qrClient';

type TicketTabFilter = 'ALL' | 'UPCOMING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';

export const MyTicketsModal: React.FC<{
  onRefreshInventory: () => Promise<void>;
}> = ({ onRefreshInventory }) => {
  const activeModal = useStadiumStore((s) => s.activeModal);
  const setActiveModal = useStadiumStore((s) => s.setActiveModal);
  const sessionToken = useStadiumStore((s) => s.sessionToken);
  const seats = useStadiumStore((s) => s.seats);
  const enterSeatView = useStadiumStore((s) => s.enterSeatView);
  const showToast = useStadiumStore((s) => s.showToast);

  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TicketTabFilter>('ALL');
  const [lightboxPass, setLightboxPass] = useState<{
    ticket: any;
    booking: any;
    match: any;
    stadium: any;
    payment: any;
  } | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [downloadingPdfCode, setDownloadingPdfCode] = useState<string | null>(null);

  const loadBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/bookings/my', {
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      });
      const data = await res.json();
      if (data.bookings) {
        setBookings(data.bookings);
      }
    } catch {
      showToast('Failed to load your digital ticket wallet', 'error');
    } finally {
      setLoading(false);
    }
  }, [sessionToken, showToast]);

  useEffect(() => {
    if (activeModal === 'MY_TICKETS') {
      loadBookings();
      setConfirmCancelId(null);
      setLightboxPass(null);
    }
  }, [activeModal, loadBookings]);

  const filteredBookings = useMemo(() => {
    if (activeTab === 'ALL') return bookings;
    return bookings.filter((item) => {
      const bStatus = String(item.booking?.status || '').toUpperCase();
      const mStatus = String(item.match?.status || '').toUpperCase();
      if (activeTab === 'CANCELLED') {
        return bStatus === 'CANCELLED' || bStatus === 'REFUNDED';
      }
      if (activeTab === 'CONFIRMED') {
        return bStatus === 'CONFIRMED';
      }
      if (activeTab === 'UPCOMING') {
        return bStatus === 'CONFIRMED' && (mStatus === 'UPCOMING' || mStatus === 'LIVE');
      }
      if (activeTab === 'COMPLETED') {
        return mStatus === 'COMPLETED';
      }
      return true;
    });
  }, [bookings, activeTab]);

  const summary = useMemo(() => {
    const confirmedCount = bookings.filter((b) => b.booking?.status === 'CONFIRMED').length;
    const validPasses = bookings.reduce(
      (acc, b) =>
        acc + (b.tickets || []).filter((t: any) => t.status === 'VALID').length,
      0
    );
    const cancelledCount = bookings.filter(
      (b) => b.booking?.status === 'CANCELLED' || b.booking?.status === 'REFUNDED'
    ).length;
    return {
      totalBookings: bookings.length,
      confirmedCount,
      validPasses,
      cancelledCount,
    };
  }, [bookings]);

  if (activeModal !== 'MY_TICKETS') return null;

  const handleCancelBooking = async (bookingId: number) => {
    setCancellingId(bookingId);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Cancellation failed', 'error');
        return;
      }
      showToast(
        `Booking ${data.bookingReference} cancelled. Refund ₹${(
          data.refundAmountPaise / 100
        ).toLocaleString('en-IN')} (${data.refundTier}) initiated.`,
        'success'
      );
      setConfirmCancelId(null);
      await loadBookings();
      await onRefreshInventory();
    } catch {
      showToast('Failed to cancel booking', 'error');
    } finally {
      setCancellingId(null);
    }
  };

  const handleDownloadPdf = async (item: any, ticket: any) => {
    setDownloadingPdfCode(ticket.ticketCode);
    try {
      await downloadTicketPdf({
        ticket,
        booking: item.booking,
        match: item.match,
        stadium: item.stadium,
        payment: item.payment,
      });
      showToast(`Saved PDF ticket pass STADIUMX-${ticket.ticketCode}.pdf`, 'success');
    } catch {
      showToast('Could not generate PDF pass', 'error');
    } finally {
      setDownloadingPdfCode(null);
    }
  };

  const handleShareSafeDetails = async (item: any, ticket: any) => {
    const dateLabel = item.match?.startTime
      ? new Date(item.match.startTime).toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '';
    const shareText = `${item.match?.title || 'STADIUMX Match'} (${dateLabel})\nVenue: ${
      item.stadium?.name || 'STADIUMX Stadium'
    }, ${item.stadium?.city || ''}\nSeat: ${ticket.seatCode} · ${ticket.standName} (${
      ticket.blockName
    }, Row ${ticket.rowNumber})\nTicket Ref: ${ticket.ticketCode} · Booking: ${
      item.booking.bookingReference
    }`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `STADIUMX Ticket · ${ticket.seatCode}`,
          text: shareText,
        });
      } else {
        await navigator.clipboard?.writeText(shareText);
        showToast(`Copied safe match & seat summary for ${ticket.seatCode}`, 'info');
      }
    } catch {
      // User dismissed share sheet
    }
  };

  const tabs: Array<{ id: TicketTabFilter; label: string }> = [
    { id: 'ALL', label: `All (${bookings.length})` },
    { id: 'UPCOMING', label: 'Upcoming' },
    { id: 'CONFIRMED', label: `Confirmed (${summary.confirmedCount})` },
    { id: 'COMPLETED', label: 'Completed' },
    { id: 'CANCELLED', label: `Cancelled (${summary.cancelledCount})` },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="my-tickets-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5"
    >
      <div className="w-full max-w-5xl rounded-xl bg-[#0B0F17] border border-white/10 text-slate-100 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#0F172A] border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <Ticket className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 id="my-tickets-title" className="text-base sm:text-lg font-bold text-white">
                My Digital Passes & Ticket Wallet
              </h2>
              <p className="text-xs text-slate-400">
                Scannable turnstile QR passes · Official PDF ticket downloads · Booking & refund ledger
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveModal('MY_QR')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-xs font-semibold text-emerald-300 transition-colors"
            >
              <QrCode className="w-3.5 h-3.5" />
              My QR
            </button>
            <button
              type="button"
              onClick={() => setActiveModal('NONE')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-medium text-slate-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
        </div>

        {/* Summary Metrics & Status Filter Tabs */}
        <div className="px-6 py-3 bg-[#0F172A]/60 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  activeTab === tab.id
                    ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-[#0B0F17] border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-300">
            <span>
              Valid Passes: <strong className="text-emerald-400">{summary.validPasses}</strong>
            </span>
            <span>
              Orders: <strong className="text-white">{summary.totalBookings}</strong>
            </span>
          </div>
        </div>

        {/* Bookings & Passes Feed */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <div className="space-y-4">
              {[1, 2].map((n) => (
                <div
                  key={n}
                  className="h-48 rounded-xl bg-[#0F172A] border border-white/10 animate-pulse"
                />
              ))}
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="rounded-xl bg-[#0F172A] border border-white/10 py-14 px-6 text-center space-y-3">
              <Ticket className="w-9 h-9 text-slate-500 mx-auto" />
              <div className="text-sm font-semibold text-white">
                {bookings.length === 0
                  ? 'No stadium bookings in your wallet yet'
                  : `No bookings under "${activeTab}" filter`}
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Explore the 3D seating bowl to inspect live sightlines and reserve seats with instant scannable QR tickets.
              </p>
              <button
                type="button"
                onClick={() => setActiveModal('NONE')}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
              >
                Explore 3D Stadium Seats
              </button>
            </div>
          ) : (
            filteredBookings.map((item) => {
              const home = item.match?.homeTeam;
              const away = item.match?.awayTeam;
              const isConfirmed = item.booking.status === 'CONFIRMED';

              return (
                <div
                  key={item.booking.id}
                  data-testid={`booking-card-${item.booking.bookingReference}`}
                  className="rounded-xl bg-[#0F172A] border border-white/10 overflow-hidden"
                >
                  {/* Booking / Match Header Strip */}
                  <div className="px-5 py-4 bg-[#11192C] border-b border-white/10 flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2.5">
                        {home && away && (
                          <div className="inline-flex items-center gap-1.5 text-xs font-bold">
                            <span
                              className="px-2 py-0.5 rounded font-mono text-[11px] text-white"
                              style={{ backgroundColor: home.primaryColor || '#1D4ED8' }}
                            >
                              {home.shortName || home.code}
                            </span>
                            <span className="text-slate-500 text-[11px]">vs</span>
                            <span
                              className="px-2 py-0.5 rounded font-mono text-[11px] text-white"
                              style={{ backgroundColor: away.primaryColor || '#0F766E' }}
                            >
                              {away.shortName || away.code}
                            </span>
                          </div>
                        )}
                        <h3 className="text-sm font-bold text-white">
                          {item.match?.title || `Match #${item.booking.matchId}`}
                        </h3>
                        <span
                          className={`px-2 py-0.5 rounded border text-[10px] font-mono font-bold ${
                            isConfirmed
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                              : 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                          }`}
                        >
                          {item.booking.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-sky-400" />
                          {item.match?.startTime
                            ? new Date(item.match.startTime).toLocaleString('en-IN', {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })
                            : ''}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                          {item.stadium?.name || 'STADIUMX Oval'}
                          {item.stadium?.city ? `, ${item.stadium.city}` : ''}
                        </span>
                        <span className="inline-flex items-center gap-1 font-mono text-slate-300">
                          <Receipt className="w-3.5 h-3.5 text-slate-400" />
                          Ref: {item.booking.bookingReference}
                        </span>
                      </div>
                    </div>

                    {/* Payment Summary + Cancel CTA */}
                    <div className="flex flex-wrap items-center gap-4">
                      <div className="text-right font-mono tabular-nums">
                        <div className="text-sm font-bold text-white">
                          ₹{(item.booking.totalAmountPaise / 100).toLocaleString('en-IN')}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {item.payment?.status || 'CAPTURED'}
                          {item.payment?.razorpayPaymentId
                            ? ` · ${item.payment.razorpayPaymentId}`
                            : ''}
                        </div>
                        {item.booking.refundAmountPaise > 0 && (
                          <div className="text-[10px] text-amber-400">
                            Refunded ₹
                            {(item.booking.refundAmountPaise / 100).toLocaleString('en-IN')}
                          </div>
                        )}
                      </div>

                      {isConfirmed && (
                        confirmCancelId === item.booking.id ? (
                          <div className="flex items-center gap-2 rounded-lg bg-rose-950/70 border border-rose-500/50 px-3 py-1.5">
                            <span className="text-[11px] text-rose-200 font-medium">
                              Confirm refund cancellation?
                            </span>
                            <button
                              type="button"
                              disabled={cancellingId === item.booking.id}
                              onClick={() => handleCancelBooking(item.booking.id)}
                              className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-semibold"
                            >
                              {cancellingId === item.booking.id ? 'Cancelling...' : 'Yes, Cancel'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmCancelId(null)}
                              className="px-2 py-1 rounded bg-slate-800 text-slate-300 text-[11px]"
                            >
                              Keep
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmCancelId(item.booking.id)}
                            className="px-3 py-1.5 rounded-lg bg-rose-950/70 hover:bg-rose-900 border border-rose-500/40 text-rose-200 text-xs font-medium transition-colors"
                          >
                            Cancel & Refund
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  {/* Individual Digital Pass Cards */}
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {item.tickets.map((t: any) => (
                      <div
                        key={t.id}
                        data-testid={`ticket-pass-${t.ticketCode}`}
                        className="rounded-xl bg-[#0B0F17] border border-white/10 p-4 flex flex-col sm:flex-row items-start gap-4"
                      >
                        {/* Scannable High-Contrast QR Frame */}
                        {t.qrDataUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              setLightboxPass({
                                ticket: t,
                                booking: item.booking,
                                match: item.match,
                                stadium: item.stadium,
                                payment: item.payment,
                              })
                            }
                            title="Enlarge Turnstile QR Pass"
                            className="group relative bg-white p-2 rounded-lg border border-white/20 shrink-0 self-center sm:self-start focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <img
                              src={t.qrDataUrl}
                              alt={`QR pass for ${t.ticketCode}`}
                              referrerPolicy="no-referrer"
                              className="w-28 h-28 object-contain"
                            />
                            <span className="mt-1 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-700 group-hover:text-emerald-700">
                              <Maximize2 className="w-3 h-3" />
                              Tap to Enlarge
                            </span>
                          </button>
                        )}

                        {/* Pass Metadata & Actions */}
                        <div className="flex-1 min-w-0 space-y-2 w-full">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs font-bold text-white truncate">
                              {t.ticketCode}
                            </span>
                            <span
                              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                                t.status === 'VALID'
                                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                                  : t.status === 'USED'
                                  ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                                  : 'text-rose-300 border-rose-500/40 bg-rose-500/10'
                              }`}
                            >
                              {t.status}
                            </span>
                          </div>

                          <div>
                            <div className="text-sm font-bold text-emerald-400 font-mono">
                              Seat {t.seatCode}
                            </div>
                            <div className="text-xs font-medium text-slate-200">
                              {t.standName} · {t.categoryName}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {t.blockName} · Row {t.rowNumber} · Seat {t.seatNumber}
                            </div>
                          </div>

                          {/* Pass Action Buttons */}
                          <div className="pt-2 border-t border-white/10 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setLightboxPass({
                                  ticket: t,
                                  booking: item.booking,
                                  match: item.match,
                                  stadium: item.stadium,
                                  payment: item.payment,
                                })
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-white"
                            >
                              <Maximize2 className="w-3 h-3 text-emerald-400" />
                              View Pass
                            </button>

                            <button
                              type="button"
                              disabled={downloadingPdfCode === t.ticketCode}
                              onClick={() => handleDownloadPdf(item, t)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-[11px] font-semibold text-white"
                            >
                              <FileDown className="w-3 h-3" />
                              {downloadingPdfCode === t.ticketCode ? 'Saving...' : 'PDF'}
                            </button>

                            {t.qrDataUrl && (
                              <button
                                type="button"
                                onClick={() => {
                                  downloadQrPng(t.qrDataUrl, `STADIUMX-${t.ticketCode}.png`);
                                  showToast(`Downloaded QR image for ${t.ticketCode}`, 'info');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200"
                              >
                                <Download className="w-3 h-3 text-sky-400" />
                                QR PNG
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleShareSafeDetails(item, t)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200"
                            >
                              <Share2 className="w-3 h-3 text-slate-300" />
                              Share
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                const found = seats.find((s) => s.seatCode === t.seatCode);
                                if (found) {
                                  enterSeatView(found);
                                  setActiveModal('NONE');
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-emerald-300"
                            >
                              <Eye className="w-3 h-3" />
                              3D View
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* High-Contrast Lightbox / Enlarged Pass Modal */}
      {lightboxPass && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged Digital Match Pass"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#0F172A] border border-white/15 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[#0B0F17] border-b border-white/10 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
                  STADIUMX TURNSTILE PASS
                </div>
                <h3 className="text-sm font-bold text-white mt-0.5">
                  {lightboxPass.match?.title || 'Official Match Ticket'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setLightboxPass(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                aria-label="Close enlarged pass"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center text-center space-y-4">
              {lightboxPass.ticket.qrDataUrl && (
                <div className="bg-white p-3.5 rounded-xl shadow-inner border border-slate-200">
                  <img
                    src={lightboxPass.ticket.qrDataUrl}
                    alt={`Full screen QR for ${lightboxPass.ticket.ticketCode}`}
                    className="w-56 h-56 object-contain"
                  />
                </div>
              )}

              <div className="w-full rounded-xl bg-[#0B0F17] border border-white/10 p-3.5 grid grid-cols-2 gap-3 text-left text-xs">
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Seat Code</div>
                  <div className="font-mono font-bold text-emerald-400">
                    {lightboxPass.ticket.seatCode}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Ticket Ref</div>
                  <div className="font-mono font-bold text-white">
                    {lightboxPass.ticket.ticketCode}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Stand & Block</div>
                  <div className="font-medium text-white">
                    {lightboxPass.ticket.standName} ({lightboxPass.ticket.blockName})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Row / Seat</div>
                  <div className="font-mono text-white">
                    Row {lightboxPass.ticket.rowNumber} · Seat {lightboxPass.ticket.seatNumber}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Booking / Order</div>
                  <div className="font-mono text-slate-200 truncate">
                    {lightboxPass.booking.bookingReference}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Payment</div>
                  <div className="font-mono text-slate-200">
                    {lightboxPass.payment?.status || 'CAPTURED'}
                  </div>
                </div>
              </div>

              {lightboxPass.ticket.status === 'USED' && (
                <div className="w-full flex items-center gap-2 rounded-lg bg-amber-950/60 border border-amber-500/40 px-3 py-2 text-[11px] text-amber-200 text-left">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>This pass has already been scanned for stadium entry.</span>
                </div>
              )}

              <div className="w-full grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    handleDownloadPdf(
                      {
                        booking: lightboxPass.booking,
                        match: lightboxPass.match,
                        stadium: lightboxPass.stadium,
                        payment: lightboxPass.payment,
                      },
                      lightboxPass.ticket
                    )
                  }
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                >
                  <FileDown className="w-4 h-4" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (lightboxPass.ticket.qrDataUrl) {
                      downloadQrPng(
                        lightboxPass.ticket.qrDataUrl,
                        `STADIUMX-${lightboxPass.ticket.ticketCode}.png`
                      );
                    }
                  }}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-white text-xs font-semibold"
                >
                  <Download className="w-4 h-4 text-emerald-400" />
                  Save QR PNG
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
