import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Download,
  Eye,
  FileDown,
  MapPin,
  Maximize2,
  QrCode,
  Receipt,
  RefreshCw,
  Ticket,
  X,
} from 'lucide-react';
import { useStadiumStore } from '../store/useStadiumStore';
import {
  collectCustomerQrMatchOptions,
  extractConfirmedCustomerQrPasses,
  type CustomerBookingRecord,
  type CustomerQrPassItem,
} from '../shared/customerQr';
import { downloadQrPng, downloadTicketPdf } from '../utils/qrClient';

export const MyQrModal: React.FC = () => {
  const activeModal = useStadiumStore((s) => s.activeModal);
  const setActiveModal = useStadiumStore((s) => s.setActiveModal);
  const sessionToken = useStadiumStore((s) => s.sessionToken);
  const seats = useStadiumStore((s) => s.seats);
  const enterSeatView = useStadiumStore((s) => s.enterSeatView);
  const showToast = useStadiumStore((s) => s.showToast);

  const [bookings, setBookings] = useState<CustomerBookingRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [selectedMatchId, setSelectedMatchId] = useState<number | 'ALL'>('ALL');
  const [enlargedPass, setEnlargedPass] = useState<CustomerQrPassItem | null>(null);
  const [downloadingPdfCode, setDownloadingPdfCode] = useState<string | null>(null);

  const loadCustomerQrPasses = useCallback(async () => {
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
      showToast('Failed to load your QR passes', 'error');
    } finally {
      setLoading(false);
    }
  }, [sessionToken, showToast]);

  useEffect(() => {
    if (activeModal === 'MY_QR') {
      loadCustomerQrPasses();
      setEnlargedPass(null);
    }
  }, [activeModal, loadCustomerQrPasses]);

  const matchOptions = useMemo(
    () => collectCustomerQrMatchOptions(bookings),
    [bookings]
  );

  const confirmedPasses = useMemo(
    () => extractConfirmedCustomerQrPasses(bookings, selectedMatchId),
    [bookings, selectedMatchId]
  );

  useEffect(() => {
    if (
      selectedMatchId !== 'ALL' &&
      !matchOptions.some((opt) => opt.matchId === selectedMatchId)
    ) {
      setSelectedMatchId('ALL');
    }
  }, [matchOptions, selectedMatchId]);

  if (activeModal !== 'MY_QR') return null;

  const handleDownloadPdf = async (pass: CustomerQrPassItem) => {
    setDownloadingPdfCode(pass.ticket.ticketCode);
    try {
      await downloadTicketPdf({
        ticket: pass.ticket,
        booking: pass.booking,
        match: pass.match,
        stadium: pass.stadium,
        payment: pass.payment,
      });
      showToast(`Saved PDF ticket STADIUMX-${pass.ticket.ticketCode}.pdf`, 'success');
    } catch {
      showToast('Could not generate PDF pass', 'error');
    } finally {
      setDownloadingPdfCode(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="my-qr-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5"
    >
      <div className="w-full max-w-5xl rounded-xl bg-[#0B0F17] border border-white/10 text-slate-100 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#0F172A] border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <QrCode className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 id="my-qr-title" className="text-base sm:text-lg font-bold text-white">
                My QR Passes
              </h2>
              <p className="text-xs text-slate-400">
                Ready-to-scan entry QR codes for your confirmed stadium bookings
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadCustomerQrPasses}
              disabled={loading}
              aria-label="Refresh My QR Passes"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-xs font-medium text-slate-200 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => setActiveModal('MY_TICKETS')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-medium text-emerald-300 transition-colors"
            >
              <Ticket className="w-3.5 h-3.5" />
              My Tickets
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

        {/* Event Filter Strip (shown when confirmed passes exist) */}
        {confirmedPasses.length > 0 && (
          <div className="px-6 py-3 bg-[#0F172A]/60 border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedMatchId('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                  selectedMatchId === 'ALL'
                    ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                    : 'bg-[#0B0F17] border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                All Events ({matchOptions.reduce((sum, m) => sum + m.count, 0)})
              </button>
              {matchOptions.map((opt) => (
                <button
                  key={opt.matchId}
                  type="button"
                  onClick={() => setSelectedMatchId(opt.matchId)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    selectedMatchId === opt.matchId
                      ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-[#0B0F17] border-white/10 text-slate-400 hover:text-white'
                  }`}
                >
                  {opt.title} ({opt.count})
                </button>
              ))}
            </div>

            <div className="text-xs font-mono tabular-nums text-slate-300">
              Confirmed QR Passes:{' '}
              <strong className="text-emerald-400">{confirmedPasses.length}</strong>
            </div>
          </div>
        )}

        {/* Confirmed QR Cards Grid or Empty State */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2].map((n) => (
                <div
                  key={n}
                  className="h-56 rounded-xl bg-[#0F172A] border border-white/10 animate-pulse"
                />
              ))}
            </div>
          ) : confirmedPasses.length === 0 ? (
            <div
              data-testid="my-qr-empty-state"
              className="rounded-xl bg-[#0F172A] border border-white/10 py-14 px-6 text-center space-y-4 max-w-xl mx-auto my-4"
            >
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-white/10 flex items-center justify-center mx-auto">
                <QrCode className="w-7 h-7 text-slate-400" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-white">
                  No Confirmed QR Passes Yet
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  Once you reserve seats and complete checkout, your scannable match-day QR tickets will appear here for quick stadium gate entry.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setActiveModal('NONE')}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                >
                  Browse 3D Stadium Seats
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal('SMART_FINDER')}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs font-medium transition-colors"
                >
                  Find Best Seats
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal('MY_TICKETS')}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300 text-xs font-medium transition-colors"
                >
                  Check My Tickets
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {confirmedPasses.map((pass) => {
                const { ticket, booking, match, stadium } = pass;
                const home = match?.homeTeam;
                const away = match?.awayTeam;
                const kickoffText = match?.startTime
                  ? new Date(match.startTime).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : '';

                return (
                  <article
                    key={pass.id}
                    data-testid={`my-qr-card-${ticket.ticketCode}`}
                    className="rounded-xl bg-[#0F172A] border border-white/10 overflow-hidden flex flex-col justify-between"
                  >
                    {/* Event Strip */}
                    <div className="px-4 py-3 bg-[#11192C] border-b border-white/10 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          {home && away && (
                            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold">
                              <span
                                className="px-1.5 py-0.5 rounded font-mono text-white"
                                style={{ backgroundColor: home.primaryColor || '#1D4ED8' }}
                              >
                                {home.shortName || home.code}
                              </span>
                              <span className="text-slate-500">vs</span>
                              <span
                                className="px-1.5 py-0.5 rounded font-mono text-white"
                                style={{ backgroundColor: away.primaryColor || '#0F766E' }}
                              >
                                {away.shortName || away.code}
                              </span>
                            </div>
                          )}
                          <h3 className="text-sm font-bold text-white truncate">
                            {match?.title || `Match #${booking.matchId}`}
                          </h3>
                        </div>

                        <span className="px-2 py-0.5 rounded border text-[10px] font-mono font-bold bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shrink-0">
                          {booking.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                        {kickoffText && (
                          <span className="inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-sky-400" />
                            {kickoffText}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-emerald-400" />
                          {stadium?.name || 'STADIUMX Oval'}
                        </span>
                      </div>
                    </div>

                    {/* QR + Seat & Booking Reference Body */}
                    <div className="p-4 flex flex-col sm:flex-row items-center sm:items-start gap-4">
                      {ticket.qrDataUrl && (
                        <button
                          type="button"
                          onClick={() => setEnlargedPass(pass)}
                          aria-label={`Enlarge QR code for seat ${ticket.seatCode}`}
                          className="group bg-white p-2.5 rounded-xl border border-white/20 shrink-0 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          <img
                            src={ticket.qrDataUrl}
                            alt={`Entry QR code for seat ${ticket.seatCode}`}
                            referrerPolicy="no-referrer"
                            className="w-32 h-32 object-contain"
                          />
                          <span className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-semibold text-slate-700 group-hover:text-emerald-700">
                            <Maximize2 className="w-3 h-3" />
                            Enlarge QR
                          </span>
                        </button>
                      )}

                      <div className="flex-1 min-w-0 w-full space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-base font-bold font-mono text-emerald-400">
                            Seat {ticket.seatCode}
                          </div>
                          <span
                            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                              ticket.status === 'VALID'
                                ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                                : 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                            }`}
                          >
                            {ticket.status}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-xs bg-[#0B0F17] border border-white/10 rounded-lg p-2.5">
                          <div>
                            <div className="text-[10px] uppercase text-slate-400">Stand</div>
                            <div className="font-medium text-white truncate">
                              {ticket.standName}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase text-slate-400">Seat Number</div>
                            <div className="font-mono text-white">
                              Row {ticket.rowNumber} · #{ticket.seatNumber}
                            </div>
                          </div>
                          <div className="col-span-2 pt-1 border-t border-white/10 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-300 truncate">
                              <Receipt className="w-3 h-3 text-slate-400 shrink-0" />
                              Ref: {booking.bookingReference}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">
                              {ticket.ticketCode}
                            </span>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setEnlargedPass(pass)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[11px] font-semibold text-white transition-colors"
                          >
                            <Maximize2 className="w-3 h-3" />
                            Enlarge QR
                          </button>

                          {ticket.qrDataUrl && (
                            <button
                              type="button"
                              onClick={() => {
                                downloadQrPng(
                                  ticket.qrDataUrl!,
                                  `STADIUMX-${ticket.ticketCode}.png`
                                );
                                showToast(
                                  `Downloaded QR PNG for ${ticket.seatCode}`,
                                  'info'
                                );
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 transition-colors"
                            >
                              <Download className="w-3 h-3 text-sky-400" />
                              PNG
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={downloadingPdfCode === ticket.ticketCode}
                            onClick={() => handleDownloadPdf(pass)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 transition-colors"
                          >
                            <FileDown className="w-3 h-3 text-sky-400" />
                            {downloadingPdfCode === ticket.ticketCode ? 'Saving...' : 'PDF'}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              const found = seats.find(
                                (s) => s.seatCode === ticket.seatCode
                              );
                              if (found) {
                                enterSeatView(found);
                                setActiveModal('NONE');
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-emerald-300 transition-colors"
                          >
                            <Eye className="w-3 h-3" />
                            3D View
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Enlarged Full-Contrast Customer QR Modal */}
      {enlargedPass && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged Match QR Code"
          data-testid="my-qr-enlarged-dialog"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#0F172A] border border-white/15 overflow-hidden shadow-2xl">
            <div className="px-5 py-4 bg-[#0B0F17] border-b border-white/10 flex items-center justify-between">
              <div className="min-w-0 pr-3">
                <div className="text-[11px] font-mono uppercase tracking-wider text-emerald-400">
                  STADIUMX ENTRY QR · {enlargedPass.booking.status}
                </div>
                <h3 className="text-sm font-bold text-white mt-0.5 truncate">
                  {enlargedPass.match?.title || 'Official Match Pass'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEnlargedPass(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                aria-label="Close enlarged QR code"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center text-center space-y-4">
              {enlargedPass.ticket.qrDataUrl && (
                <div className="bg-white p-4 rounded-xl shadow-inner border border-slate-200">
                  <img
                    src={enlargedPass.ticket.qrDataUrl}
                    alt={`Enlarged QR for ${enlargedPass.ticket.seatCode}`}
                    className="w-60 h-60 object-contain"
                  />
                </div>
              )}

              <div className="w-full rounded-xl bg-[#0B0F17] border border-white/10 p-3.5 grid grid-cols-2 gap-3 text-left text-xs">
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Seat</div>
                  <div className="font-mono font-bold text-emerald-400">
                    {enlargedPass.ticket.seatCode}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Seat Number</div>
                  <div className="font-mono text-white">
                    Row {enlargedPass.ticket.rowNumber} · Seat {enlargedPass.ticket.seatNumber}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Stand & Block</div>
                  <div className="font-medium text-white">
                    {enlargedPass.ticket.standName} ({enlargedPass.ticket.blockName})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Booking Ref</div>
                  <div className="font-mono text-slate-200 truncate">
                    {enlargedPass.booking.bookingReference}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Booking Status</div>
                  <div className="font-mono font-semibold text-emerald-400">
                    {enlargedPass.booking.status} ({enlargedPass.ticket.status})
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-slate-400">Ticket Code</div>
                  <div className="font-mono text-slate-200 truncate">
                    {enlargedPass.ticket.ticketCode}
                  </div>
                </div>
              </div>

              <div className="w-full grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => handleDownloadPdf(enlargedPass)}
                  className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                >
                  <FileDown className="w-4 h-4" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (enlargedPass.ticket.qrDataUrl) {
                      downloadQrPng(
                        enlargedPass.ticket.qrDataUrl,
                        `STADIUMX-${enlargedPass.ticket.ticketCode}.png`
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
