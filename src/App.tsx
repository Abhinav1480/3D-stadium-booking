/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useStadiumStore } from './store/useStadiumStore';
import { StadiumCanvas3D } from './components/StadiumCanvas3D';
import { FallbackSeatMap2D } from './components/FallbackSeatMap2D';
import { ViewFromSeatHud } from './components/ViewFromSeatHud';
import { StadiumMiniMap } from './components/StadiumMiniMap';
import { SeatAvailabilityLegend } from './components/SeatAvailabilityLegend';
import { BottomControlDock } from './components/BottomControlDock';
import { SmartFinderModal } from './components/SmartFinderModal';
import { BookingCheckoutModal } from './components/BookingCheckoutModal';
import { MyTicketsModal } from './components/MyTicketsModal';
import { AdminDashboardModal } from './components/AdminDashboardModal';
import { GateScannerModal } from './components/GateScannerModal';
import { soundEngine } from './utils/soundEngine';

export default function App() {
  const activeMatchId = useStadiumStore((s) => s.activeMatchId);
  const seats = useStadiumStore((s) => s.seats);
  const selectedSeatIds = useStadiumStore((s) => s.selectedSeatIds);
  const activeHold = useStadiumStore((s) => s.activeHold);
  const is2DFallback = useStadiumStore((s) => s.is2DFallback);
  const activeModal = useStadiumStore((s) => s.activeModal);
  const toastMessage = useStadiumStore((s) => s.toastMessage);
  const sessionToken = useStadiumStore((s) => s.sessionToken);

  const setUserSession = useStadiumStore((s) => s.setUserSession);
  const setStadiumData = useStadiumStore((s) => s.setStadiumData);
  const setMatches = useStadiumStore((s) => s.setMatches);
  const setMatchInventory = useStadiumStore((s) => s.setMatchInventory);
  const applySocketSeatUpdate = useStadiumStore((s) => s.applySocketSeatUpdate);
  const setActiveHold = useStadiumStore((s) => s.setActiveHold);
  const setActiveModal = useStadiumStore((s) => s.setActiveModal);
  const enterSeatView = useStadiumStore((s) => s.enterSeatView);
  const setFocusedSeat = useStadiumStore((s) => s.setFocusedSeat);
  const showToast = useStadiumStore((s) => s.showToast);

  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [holdingSeats, setHoldingSeats] = useState<boolean>(false);

  const loadMatchesAndInventory = useCallback(
    async (matchIdToLoad: number) => {
      const [matchesRes, invRes] = await Promise.all([
        fetch('/api/matches'),
        fetch(`/api/matches/${matchIdToLoad}/inventory`),
      ]);
      const matchesJson = await matchesRes.json();
      const invJson = await invRes.json();

      if (matchesJson.matches) {
        setMatches(matchesJson.matches);
      }
      if (invJson.inventory && invJson.pricing) {
        setMatchInventory(invJson.inventory, invJson.pricing);
      }
    },
    [setMatches, setMatchInventory]
  );

  // Initial Bootstrap: Auth + 4,800-Seat Stadium Geometry + Match Inventory
  useEffect(() => {
    let mounted = true;

    async function bootstrap() {
      try {
        const params = new URLSearchParams(window.location.search);
        const paramVisitor = params.get('visitor');
        if (paramVisitor) {
          try {
            window.sessionStorage?.setItem('stadiumx_visitor_id', paramVisitor);
          } catch {}
        }
        let visitorId: string | null = null;
        try {
          visitorId = window.sessionStorage?.getItem('stadiumx_visitor_id') || null;
        } catch {}

        const [meRes, stadiumRes, seatsRes] = await Promise.all([
          fetch('/api/auth/me', {
            headers: visitorId ? { 'x-stadiumx-visitor': visitorId } : undefined,
          }),
          fetch('/api/stadium'),
          fetch('/api/stadium/seats'),
        ]);

        const meData = await meRes.json();
        const stadiumData = await stadiumRes.json();
        const seatsData = await seatsRes.json();

        if (!mounted) return;

        if (meData.user) {
          setUserSession(meData.user, meData.token || null);
        }

        const loadedSeats = seatsData.seats || [];
        if (stadiumData.stadium?.spec && loadedSeats.length > 0) {
          setStadiumData(stadiumData.stadium.spec, loadedSeats);
        }

        await loadMatchesAndInventory(activeMatchId);

        // Check URL parameters for deep-linked seat (?seat=N-T2-R03-S10) or default spotlight seat
        const requestedSeatCode = params.get('seat');
        if (requestedSeatCode && loadedSeats.length > 0) {
          const found = loadedSeats.find(
            (s: any) =>
              s.seatCode.toUpperCase() === requestedSeatCode.toUpperCase()
          );
          if (found) {
            enterSeatView(found);
          }
        } else if (loadedSeats.length > 0) {
          // Focus a prime North Presidential VIP seat by default so the Sightline Inspector is immediately visible
          const primeSeat =
            loadedSeats.find((s: any) => s.seatCode === 'N-T2-R03-S10') ||
            loadedSeats[0];
          setFocusedSeat(primeSeat);
        }
      } catch (err) {
        console.error('Failed to bootstrap STADIUMX:', err);
      } finally {
        if (mounted) {
          setInitialLoading(false);
        }
      }
    }

    bootstrap();
    return () => {
      mounted = false;
    };
  }, []);

  // Reload inventory when activeMatchId changes
  useEffect(() => {
    if (!initialLoading) {
      loadMatchesAndInventory(activeMatchId);
    }
  }, [activeMatchId, initialLoading, loadMatchesAndInventory]);

  // Connect to Real-Time Socket.IO Server for Live Seat Updates
  useEffect(() => {
    const socket: Socket = io({
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      socket.emit('match:join', activeMatchId);
    });

    socket.on('seat:updated', (payload: any) => {
      if (payload && payload.matchId === useStadiumStore.getState().activeMatchId) {
        applySocketSeatUpdate({
          seatIds: payload.seatIds || [],
          status: payload.status,
          holdUserId: payload.holdUserId,
          holdExpiresAt: payload.holdExpiresAt,
          holdToken: payload.holdToken,
        });
      }
    });

    return () => {
      socket.emit('match:leave', activeMatchId);
      socket.disconnect();
    };
  }, [activeMatchId, applySocketSeatUpdate]);

  // Handler to Atomically Hold Selected Seats and Open Checkout
  const handleHoldSelectedSeats = async () => {
    if (selectedSeatIds.length === 0) {
      setActiveModal('SMART_FINDER');
      return;
    }

    setHoldingSeats(true);
    try {
      const res = await fetch(`/api/matches/${activeMatchId}/holds`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ seatIds: selectedSeatIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Could not hold seats', 'error');
        await loadMatchesAndInventory(activeMatchId);
        return;
      }
      soundEngine.playChime('hold');
      setActiveHold(data);
      setActiveModal('CHECKOUT');
      showToast(
        `Locked ${data.seats.length} seat(s) for 8 minutes (${data.holdToken})`,
        'success'
      );
    } catch {
      showToast('Network error placing seat hold', 'error');
    } finally {
      setHoldingSeats(false);
    }
  };

  return (
    <div
      data-state={initialLoading ? 'loading' : 'ready'}
      className="relative w-screen h-screen overflow-hidden bg-[#0B0F17] text-slate-100"
    >
      {/* Top Bar Contract: Single Row, 3 Zones separated by gap-8 */}
      <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0B0F17] border-b border-white/10">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            useStadiumStore.getState().setActiveModal('NONE');
            useStadiumStore.getState().focusStand(null, null);
          }}
          className="font-display text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0"
        >
          STADIUMX
        </a>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav
          aria-label="Primary Workspace Navigation"
          className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300"
        >
          <button
            type="button"
            onClick={() => {
              const st = useStadiumStore.getState();
              if (st.activeModal !== 'NONE' || st.is2DFallback) {
                st.setIsHudCollapsed(true);
                st.setIsInspectorCollapsed(true);
                st.setIsLegendCollapsed(true);
              }
              st.setActiveModal('NONE');
              st.setIs2DFallback(false);
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeModal === 'NONE' && !is2DFallback
                ? 'text-emerald-400 underline underline-offset-4'
                : ''
            }`}
          >
            3D Bowl
          </button>
          <button
            type="button"
            onClick={() => setActiveModal('SMART_FINDER')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeModal === 'SMART_FINDER'
                ? 'text-emerald-400 underline underline-offset-4'
                : ''
            }`}
          >
            Smart Finder
          </button>
          <button
            type="button"
            onClick={() => setActiveModal('MY_TICKETS')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeModal === 'MY_TICKETS'
                ? 'text-emerald-400 underline underline-offset-4'
                : ''
            }`}
          >
            My Tickets
          </button>
          <button
            type="button"
            onClick={() => setActiveModal('ADMIN_OPS')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeModal === 'ADMIN_OPS'
                ? 'text-emerald-400 underline underline-offset-4'
                : ''
            }`}
          >
            Admin Ops
          </button>
          <button
            type="button"
            onClick={() => setActiveModal('GATE_QR')}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              activeModal === 'GATE_QR'
                ? 'text-emerald-400 underline underline-offset-4'
                : ''
            }`}
          >
            Gate QR
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="flex items-center shrink-0">
          {activeHold ? (
            <button
              type="button"
              onClick={() => setActiveModal('CHECKOUT')}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0"
            >
              Complete Hold Checkout ({activeHold.seats.length})
            </button>
          ) : selectedSeatIds.length > 0 ? (
            <button
              type="button"
              disabled={holdingSeats}
              onClick={handleHoldSelectedSeats}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              {holdingSeats
                ? 'Locking Hold...'
                : `Reserve ${selectedSeatIds.length} Selected`}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setActiveModal('SMART_FINDER')}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Find Best Seats
            </button>
          )}
        </div>
      </header>

      {/* Main Viewport: Persistent 3D WebGL Stadium Bowl + 2D Accessible Overlay */}
      <main className="w-full h-full relative">
        <div
          className={
            is2DFallback
              ? 'invisible pointer-events-none absolute inset-0'
              : 'w-full h-full'
          }
          aria-hidden={is2DFallback}
        >
          <StadiumCanvas3D />
        </div>
        {is2DFallback && (
          <div className="relative z-10 w-full h-full">
            <FallbackSeatMap2D />
          </div>
        )}
      </main>

      {/* Interactive Stadium Radar Mini-Map, Availability Legend & First-Person Sightline Inspector */}
      {!is2DFallback && activeModal === 'NONE' && (
        <>
          <StadiumMiniMap />
          <SeatAvailabilityLegend />
          <ViewFromSeatHud />
        </>
      )}

      {/* Collapsible Bottom Control Dock */}
      {activeModal === 'NONE' && (
        <BottomControlDock
          onHoldSelectedSeats={handleHoldSelectedSeats}
          holdingSeats={holdingSeats}
        />
      )}

      {/* Workspace Modals */}
      <SmartFinderModal />
      <BookingCheckoutModal
        onRefreshInventory={() => loadMatchesAndInventory(activeMatchId)}
      />
      <MyTicketsModal
        onRefreshInventory={() => loadMatchesAndInventory(activeMatchId)}
      />
      <AdminDashboardModal
        onRefreshAll={() => loadMatchesAndInventory(activeMatchId)}
      />
      <GateScannerModal />

      {/* Initial Loading Progress Overlay */}
      {initialLoading && seats.length === 0 && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0B0F17] text-slate-100">
          <div className="font-display text-2xl font-bold tracking-tight text-white">
            STADIUMX
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Generating 4,800 Parametric 3D Seats & Syncing Cloud SQL Inventory...
          </p>
        </div>
      )}

      {/* Non-Blocking Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-6 right-6 z-50 rounded-lg bg-[#0F172A] border border-white/20 px-4 py-2.5 text-xs font-medium text-white shadow-2xl"
        >
          {toastMessage.text}
        </div>
      )}
    </div>
  );
}
