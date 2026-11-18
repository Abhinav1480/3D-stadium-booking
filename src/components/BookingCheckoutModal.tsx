import React, { useEffect, useState } from 'react';
import { useStadiumStore } from '../store/useStadiumStore';
import { soundEngine } from '../utils/soundEngine';
import { downloadQrPng } from '../utils/qrClient';

export const BookingCheckoutModal: React.FC<{
  onRefreshInventory: () => Promise<void>;
}> = ({ onRefreshInventory }) => {
  const activeModal = useStadiumStore((s) => s.activeModal);
  const setActiveModal = useStadiumStore((s) => s.setActiveModal);
  const activeHold = useStadiumStore((s) => s.activeHold);
  const setActiveHold = useStadiumStore((s) => s.setActiveHold);
  const clearSelectedSeats = useStadiumStore((s) => s.clearSelectedSeats);
  const sessionToken = useStadiumStore((s) => s.sessionToken);
  const showToast = useStadiumStore((s) => s.showToast);

  const [secondsLeft, setSecondsLeft] = useState<number>(480);
  const [processingStep, setProcessingStep] = useState<
    'REVIEW' | 'RAZORPAY_GATEWAY' | 'CONFIRMED'
  >('REVIEW');
  const [checkoutOrder, setCheckoutOrder] = useState<{
    bookingId: number;
    bookingReference: string;
    razorpayOrderId: string;
    razorpayKeyId: string;
    amountPaise: number;
  } | null>(null);
  const [confirmedResult, setConfirmedResult] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (!activeHold) return;
    const updateClock = () => {
      const rem = Math.max(
        0,
        Math.floor(
          (new Date(activeHold.holdExpiresAt).getTime() - Date.now()) / 1000
        )
      );
      setSecondsLeft(rem);
      if (rem === 0 && processingStep !== 'CONFIRMED') {
        setActiveHold(null);
        showToast('Reservation hold expired (8m limit). Seats returned to inventory.', 'warning');
        onRefreshInventory();
      }
    };
    updateClock();
    const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [activeHold, processingStep]);

  useEffect(() => {
    if (activeModal === 'CHECKOUT') {
      setProcessingStep('REVIEW');
      setCheckoutOrder(null);
      setConfirmedResult(null);
    }
  }, [activeModal]);

  if (activeModal !== 'CHECKOUT') return null;

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleReleaseHold = async () => {
    if (!activeHold) {
      setActiveModal('NONE');
      return;
    }
    try {
      await fetch(
        `/api/matches/${activeHold.matchId}/holds/${activeHold.holdToken}`,
        {
          method: 'DELETE',
          headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
        }
      );
      setActiveHold(null);
      await onRefreshInventory();
      setActiveModal('NONE');
      showToast('Seat hold released back to live pool', 'info');
    } catch {
      setActiveModal('NONE');
    }
  };

  const handleCreateRazorpayOrder = async () => {
    if (!activeHold) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          matchId: activeHold.matchId,
          holdToken: activeHold.holdToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Checkout failed', 'error');
        return;
      }
      setCheckoutOrder(data);
      setProcessingStep('RAZORPAY_GATEWAY');
    } catch {
      showToast('Network error creating payment order', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteTestPayment = async () => {
    if (!checkoutOrder) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/payments/verify-test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          razorpayOrderId: checkoutOrder.razorpayOrderId,
          simulateTestSuccess: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Payment verification failed', 'error');
        return;
      }
      soundEngine.playChime('ticket');
      setConfirmedResult(data);
      setProcessingStep('CONFIRMED');
      setActiveHold(null);
      clearSelectedSeats();
      await onRefreshInventory();
      showToast('Booking confirmed! Digital QR tickets issued.', 'success');
    } catch {
      showToast('Error verifying Razorpay payment webhook', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkout-modal-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-2xl rounded-xl bg-[#0F172A] border border-white/15 p-6 text-slate-100 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h2 id="checkout-modal-title" className="text-lg font-bold text-white">
              {processingStep === 'CONFIRMED'
                ? 'Booking Confirmed — Digital QR Passes'
                : 'Atomic Seat Reservation & Razorpay Checkout'}
            </h2>
            <p className="text-xs text-slate-400">
              Authoritative PostgreSQL unique seat lock + HMAC-SHA256 signed webhook verification
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveModal('NONE')}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200"
          >
            Close
          </button>
        </div>

        {!activeHold && processingStep !== 'CONFIRMED' ? (
          <div className="py-10 text-center space-y-3">
            <p className="text-sm text-slate-300">
              No active seat hold found or your 8-minute timer expired.
            </p>
            <button
              type="button"
              onClick={() => setActiveModal('NONE')}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold"
            >
              Return to Stadium Map
            </button>
          </div>
        ) : null}

        {activeHold && processingStep === 'REVIEW' && (
          <div className="mt-4 space-y-4">
            {/* Live Hold Countdown Banner */}
            <div className="flex items-center justify-between rounded-lg bg-amber-950/60 border border-amber-500/40 px-4 py-3">
              <div>
                <div className="text-xs font-semibold text-amber-300">
                  Atomic Hold Lock Active ({activeHold.holdToken})
                </div>
                <div className="text-[11px] text-amber-200/80">
                  Seats are locked exclusively for your session in PostgreSQL & TTL broker
                </div>
              </div>
              <div className="font-mono text-xl font-bold text-amber-400 tabular-nums">
                {formatCountdown(secondsLeft)}
              </div>
            </div>

            {/* Held Seats Breakdown */}
            <div className="rounded-xl bg-[#0B0F17] border border-white/10 divide-y divide-white/10">
              {activeHold.seats.map((s) => (
                <div
                  key={s.seatId}
                  className="p-3.5 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-emerald-400">
                      {s.seatCode}
                    </span>
                    <span className="mx-2 text-slate-500">·</span>
                    <span className="text-white font-medium">{s.standName}</span>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {s.blockName} · Row {s.rowNumber} · Seat {s.seatNumber} ·{' '}
                      {s.categoryName}
                    </div>
                  </div>
                  <div className="font-mono font-semibold text-white tabular-nums">
                    ₹{(s.pricePaise / 100).toLocaleString('en-IN')}
                  </div>
                </div>
              ))}
              <div className="p-4 flex items-center justify-between bg-slate-900/60">
                <span className="text-xs font-semibold text-slate-300">
                  Total Server-Computed Payable ({activeHold.seats.length} Seats)
                </span>
                <span className="font-mono text-lg font-bold text-emerald-400 tabular-nums">
                  ₹{(activeHold.totalAmountPaise / 100).toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={handleReleaseHold}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300"
              >
                Release Hold
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleCreateRazorpayOrder}
                className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
              >
                {submitting
                  ? 'Creating Order...'
                  : 'Proceed to Razorpay Test Gateway'}
              </button>
            </div>
          </div>
        )}

        {processingStep === 'RAZORPAY_GATEWAY' && checkoutOrder && (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl bg-[#0B0F17] border border-sky-500/40 p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                  <div className="text-xs font-semibold text-sky-400">
                    RAZORPAY TEST CHECKOUT SANDBOX
                  </div>
                  <div className="font-mono text-xs text-slate-400 mt-0.5">
                    Order ID: {checkoutOrder.razorpayOrderId} · Ref:{' '}
                    {checkoutOrder.bookingReference}
                  </div>
                </div>
                <div className="font-mono text-lg font-bold text-white tabular-nums">
                  ₹{(checkoutOrder.amountPaise / 100).toLocaleString('en-IN')}
                </div>
              </div>

              <div className="text-xs text-slate-300 space-y-1">
                <p>
                  • Payment Method: UPI / Test Card (`4111 •••• •••• 1111`) — No real card data touches STADIUMX servers.
                </p>
                <p>
                  • Webhook Verification: Server validates `HMAC-SHA256(order_id | payment_id, secret)` and enforces `UNIQUE (match_id, seat_id)` inside a PostgreSQL transaction.
                </p>
              </div>

              <div className="pt-3 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setProcessingStep('REVIEW')}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-xs text-slate-300"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleCompleteTestPayment}
                  className="px-6 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                >
                  {submitting
                    ? 'Verifying Webhook Signature...'
                    : `Authorize Test Payment ₹${(
                        checkoutOrder.amountPaise / 100
                      ).toLocaleString('en-IN')}`}
                </button>
              </div>
            </div>
          </div>
        )}

        {processingStep === 'CONFIRMED' && confirmedResult && (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg bg-emerald-950/60 border border-emerald-500/40 p-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-emerald-300">
                  Booking Confirmed · Reference {confirmedResult.booking.bookingReference}
                </div>
                <div className="text-[11px] text-emerald-200/80">
                  Confirmation receipt dispatched to {useStadiumStore.getState().currentUser.email}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveModal('MY_QR')}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-emerald-500/40 text-emerald-300 text-xs font-semibold"
                >
                  Open My QR
                </button>
                <button
                  type="button"
                  onClick={() => setActiveModal('MY_TICKETS')}
                  className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                >
                  Open All My Tickets
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {confirmedResult.tickets.map((t: any) => (
                <div
                  key={t.id}
                  className="rounded-xl bg-[#0B0F17] border border-white/15 p-4 flex flex-col items-center text-center space-y-2"
                >
                  <div className="font-mono text-xs font-bold text-emerald-400">
                    {t.ticketCode}
                  </div>
                  <div className="text-xs text-white font-semibold">
                    Seat {t.seatCode} · {t.standName}
                  </div>
                  <div className="text-[11px] text-slate-400">
                    {t.blockName} · Row {t.rowNumber} Seat {t.seatNumber}
                  </div>
                  {t.qrDataUrl && (
                    <>
                      <img
                        src={t.qrDataUrl}
                        alt={`Signed QR Code for ${t.ticketCode}`}
                        referrerPolicy="no-referrer"
                        className="w-36 h-36 rounded-lg border border-white/20 bg-white p-1"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          downloadQrPng(t.qrDataUrl, `STADIUMX-${t.ticketCode}.png`);
                          showToast(`Downloaded QR pass for ${t.ticketCode}`, 'info');
                        }}
                        className="text-[11px] text-sky-400 hover:underline font-mono"
                      >
                        Download QR Pass (PNG)
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
