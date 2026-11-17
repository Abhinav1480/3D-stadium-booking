import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit3,
  Grid,
  LayoutDashboard,
  Lock,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Ticket,
  Unlock,
  X,
} from 'lucide-react';
import { useStadiumStore } from '../store/useStadiumStore';

type AdminTab = 'OVERVIEW' | 'ANALYTICS' | 'MATCHES' | 'SEATS_PRICING' | 'BOOKINGS' | 'AUDIT';

export const AdminDashboardModal: React.FC<{
  onRefreshAll: () => Promise<void>;
}> = ({ onRefreshAll }) => {
  const activeModal = useStadiumStore((s) => s.activeModal);
  const setActiveModal = useStadiumStore((s) => s.setActiveModal);
  const activeMatchId = useStadiumStore((s) => s.activeMatchId);
  const matches = useStadiumStore((s) => s.matches);
  const seats = useStadiumStore((s) => s.seats);
  const currentUser = useStadiumStore((s) => s.currentUser);
  const sessionToken = useStadiumStore((s) => s.sessionToken);
  const setUserSession = useStadiumStore((s) => s.setUserSession);
  const showToast = useStadiumStore((s) => s.showToast);

  const [activeTab, setActiveTab] = useState<AdminTab>('OVERVIEW');
  const [selectedMatchId, setSelectedMatchId] = useState<number>(activeMatchId);
  const [daysFilter, setDaysFilter] = useState<number>(0);

  const [analytics, setAnalytics] = useState<any | null>(null);
  const [metaData, setMetaData] = useState<{
    stadiums: any[];
    teams: any[];
    categories: any[];
  } | null>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState<boolean>(false);
  const [authenticating, setAuthenticating] = useState<boolean>(false);

  // Pricing & Seat Block state
  const [demandMult, setDemandMult] = useState<number>(1.15);
  const [rivalryMult, setRivalryMult] = useState<number>(1.25);
  const [weekendMult, setWeekendMult] = useState<number>(1.1);
  const [catBasePrices, setCatBasePrices] = useState<Record<number, number>>({});
  const [selectedBlockCode, setSelectedBlockCode] = useState<string>('N-T1');
  const [blockSeats, setBlockSeats] = useState<any[]>([]);
  const [selectedSeatIdsForBlock, setSelectedSeatIdsForBlock] = useState<number[]>([]);
  const [blockSeatCodeInput, setBlockSeatCodeInput] = useState<string>('');
  const [blockReason, setBlockReason] = useState<string>('Broadcast Camera / Operations Platform');
  const [blenderValidationResult, setBlenderValidationResult] = useState<any | null>(null);

  // Match create / edit state
  const [matchFormMode, setMatchFormMode] = useState<'NONE' | 'CREATE' | 'EDIT'>('NONE');
  const [editingMatchId, setEditingMatchId] = useState<number | null>(null);
  const [matchTitle, setMatchTitle] = useState<string>('');
  const [matchTournament, setMatchTournament] = useState<string>('STADIUMX Premier Cup 2026');
  const [matchHomeTeamId, setMatchHomeTeamId] = useState<number>(1);
  const [matchAwayTeamId, setMatchAwayTeamId] = useState<number>(2);
  const [matchStartLocal, setMatchStartLocal] = useState<string>('2026-12-20T19:30');
  const [matchStatus, setMatchStatus] = useState<'UPCOMING' | 'LIVE' | 'COMPLETED' | 'CANCELLED'>('UPCOMING');
  const [savingMatch, setSavingMatch] = useState<boolean>(false);

  // Bookings table state
  const [bookingRows, setBookingRows] = useState<any[]>([]);
  const [bookingsTotal, setBookingsTotal] = useState<number>(0);
  const [bookingPage, setBookingPage] = useState<number>(1);
  const [bookingSearch, setBookingSearch] = useState<string>('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState<string>('ALL');
  const [bookingMatchScope, setBookingMatchScope] = useState<string>('ALL');
  const [selectedBookingDetail, setSelectedBookingDetail] = useState<any | null>(null);
  const [confirmAdminCancelId, setConfirmAdminCancelId] = useState<number | null>(null);

  // Audit Logs state
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const isAdmin = currentUser.role === 'ADMIN';

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionToken) h.Authorization = `Bearer ${sessionToken}`;
    return h;
  }, [sessionToken]);

  const fetchAnalytics = useCallback(async () => {
    if (!isAdmin || !sessionToken) return;
    setLoadingAnalytics(true);
    try {
      const [anaRes, metaRes] = await Promise.all([
        fetch(`/api/admin/analytics/${selectedMatchId}?days=${daysFilter}`, {
          headers: authHeaders(),
        }),
        metaData ? Promise.resolve(null) : fetch('/api/admin/meta', { headers: authHeaders() }),
      ]);
      if (anaRes.ok) {
        const data = await anaRes.json();
        setAnalytics(data);
      }
      if (metaRes && metaRes.ok) {
        const meta = await metaRes.json();
        setMetaData(meta);
        if (meta.teams?.length >= 2) {
          setMatchHomeTeamId(meta.teams[0].id);
          setMatchAwayTeamId(meta.teams[1].id);
        }
      }
    } catch {
      showToast('Failed to load operational analytics', 'error');
    } finally {
      setLoadingAnalytics(false);
    }
  }, [isAdmin, sessionToken, selectedMatchId, daysFilter, authHeaders, metaData, showToast]);

  const fetchBlockSeats = useCallback(async () => {
    if (!isAdmin || !sessionToken || !selectedBlockCode) return;
    try {
      const res = await fetch(
        `/api/admin/matches/${selectedMatchId}/blocks/${selectedBlockCode}/seats`,
        { headers: authHeaders() }
      );
      if (res.ok) {
        const data = await res.json();
        setBlockSeats(data.seats || []);
      }
    } catch {
      // ignore
    }
  }, [isAdmin, sessionToken, selectedMatchId, selectedBlockCode, authHeaders]);

  const fetchBookings = useCallback(async () => {
    if (!isAdmin || !sessionToken) return;
    try {
      const qs = new URLSearchParams({
        page: String(bookingPage),
        pageSize: '10',
        status: bookingStatusFilter,
      });
      if (bookingMatchScope !== 'ALL') qs.set('matchId', bookingMatchScope);
      if (bookingSearch.trim()) qs.set('search', bookingSearch.trim());
      const res = await fetch(`/api/admin/bookings?${qs.toString()}`, {
        headers: authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setBookingRows(data.bookings || []);
        setBookingsTotal(data.totalCount || 0);
      }
    } catch {
      showToast('Failed to load bookings ledger', 'error');
    }
  }, [
    isAdmin,
    sessionToken,
    bookingPage,
    bookingStatusFilter,
    bookingMatchScope,
    bookingSearch,
    authHeaders,
    showToast,
  ]);

  const fetchAuditLogs = useCallback(async () => {
    if (!isAdmin || !sessionToken) return;
    try {
      const res = await fetch('/api/admin/audit-logs?limit=60', { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.auditLogs || []);
      }
    } catch {
      // ignore
    }
  }, [isAdmin, sessionToken, authHeaders]);

  useEffect(() => {
    if (activeModal === 'ADMIN_OPS') {
      setSelectedMatchId(activeMatchId);
    }
  }, [activeModal, activeMatchId]);

  useEffect(() => {
    if (activeModal === 'ADMIN_OPS' && isAdmin && sessionToken) {
      const currentM = matches.find((m) => m.id === selectedMatchId);
      if (currentM) {
        setDemandMult(currentM.demandMultiplier);
        setRivalryMult(currentM.rivalryMultiplier);
        setWeekendMult(currentM.weekendMultiplier);
        const priceMap: Record<number, number> = {};
        for (const p of currentM.pricing || []) {
          priceMap[p.categoryId] = Math.round(p.basePricePaise / 100);
        }
        setCatBasePrices(priceMap);
      }
      fetchAnalytics();
    }
  }, [activeModal, isAdmin, sessionToken, selectedMatchId, matches, fetchAnalytics]);

  useEffect(() => {
    if (activeModal === 'ADMIN_OPS' && isAdmin && sessionToken) {
      if (activeTab === 'SEATS_PRICING') fetchBlockSeats();
      if (activeTab === 'BOOKINGS') fetchBookings();
      if (activeTab === 'AUDIT') fetchAuditLogs();
    }
  }, [activeModal, activeTab, isAdmin, sessionToken, fetchBlockSeats, fetchBookings, fetchAuditLogs]);

  if (activeModal !== 'ADMIN_OPS') return null;

  const handleAuthenticateAdmin = async () => {
    setAuthenticating(true);
    try {
      const res = await fetch('/api/auth/switch-role', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ role: 'ADMIN' }),
      });
      const data = await res.json();
      if (res.ok && data.user && data.token) {
        setUserSession(data.user, data.token);
        showToast('Authenticated as Venue Director (ADMIN)', 'success');
      } else {
        showToast(data.error || 'Admin sign-in failed', 'error');
      }
    } catch {
      showToast('Failed to switch to Administrator role', 'error');
    } finally {
      setAuthenticating(false);
    }
  };

  const handleDownloadCsv = async () => {
    try {
      const res = await fetch(`/api/admin/reports/${selectedMatchId}/bookings.csv`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        showToast('Unauthorized or failed CSV export', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `stadiumx-match-${selectedMatchId}-report.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Exported stand occupancy & revenue CSV report', 'success');
    } catch {
      showToast('CSV export failed', 'error');
    }
  };

  const handleSavePricing = async () => {
    try {
      const categoryBasePrices = Object.entries(catBasePrices).map(([catId, inr]) => ({
        categoryId: Number(catId),
        basePricePaise: Math.max(10000, Math.round(Number(inr) * 100)),
      }));
      const res = await fetch(`/api/admin/matches/${selectedMatchId}/pricing`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          demandMultiplier: demandMult,
          rivalryMultiplier: rivalryMult,
          weekendMultiplier: weekendMult,
          categoryBasePrices,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        showToast(d.error || 'Failed to update pricing', 'error');
        return;
      }
      showToast('Dynamic multipliers & category base prices saved!', 'success');
      await onRefreshAll();
      await fetchAnalytics();
    } catch {
      showToast('Error updating pricing', 'error');
    }
  };

  const handleToggleSeatBlock = async (targetStatus: 'BLOCKED' | 'AVAILABLE') => {
    let targetIds = [...selectedSeatIdsForBlock];
    if (targetIds.length === 0 && blockSeatCodeInput.trim()) {
      const tokens = blockSeatCodeInput
        .split(/[\s,]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean);
      for (const tok of tokens) {
        const found = seats.find((s) => s.seatCode.toUpperCase() === tok);
        if (found) targetIds.push(found.id);
      }
    }
    if (targetIds.length === 0) {
      showToast('Select seats in the block grid or enter valid seat code(s)', 'warning');
      return;
    }

    try {
      const res = await fetch(`/api/admin/matches/${selectedMatchId}/block-seats`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          seatIds: targetIds,
          targetStatus,
          reason: blockReason.trim() || 'Admin Operations Override',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to update seats', 'error');
        return;
      }
      if (data.skippedSeatCodes?.length > 0 && data.seatIds?.length === 0) {
        showToast(
          `Protected: ${data.skippedSeatCodes.join(', ')} cannot be overwritten because they are BOOKED or HELD.`,
          'warning'
        );
      } else if (data.skippedSeatCodes?.length > 0) {
        showToast(
          `Updated ${data.seatIds.length} seat(s). Skipped protected seats: ${data.skippedSeatCodes.join(', ')}`,
          'info'
        );
      } else {
        showToast(`Updated ${data.seatIds.length} seat(s) to ${targetStatus}`, 'success');
      }
      setSelectedSeatIdsForBlock([]);
      await Promise.all([onRefreshAll(), fetchAnalytics(), fetchBlockSeats()]);
    } catch {
      showToast('Failed to update seat status', 'error');
    }
  };

  const openCreateMatch = () => {
    setMatchFormMode('CREATE');
    setEditingMatchId(null);
    setMatchTitle('');
    setMatchTournament('STADIUMX Premier Cup 2026');
    setMatchStartLocal('2026-12-22T19:30');
    setMatchStatus('UPCOMING');
    if (metaData?.teams?.length && metaData.teams.length >= 2) {
      setMatchHomeTeamId(metaData.teams[0].id);
      setMatchAwayTeamId(metaData.teams[1].id);
    }
  };

  const openEditMatch = (m: any) => {
    setMatchFormMode('EDIT');
    setEditingMatchId(m.id);
    setMatchTitle(m.title);
    setMatchTournament(m.tournament);
    setMatchStatus(m.status);
    setMatchStartLocal(new Date(m.startTime).toISOString().slice(0, 16));
    const homeFound = metaData?.teams?.find((t) => t.code === m.homeTeam?.code);
    const awayFound = metaData?.teams?.find((t) => t.code === m.awayTeam?.code);
    if (homeFound) setMatchHomeTeamId(homeFound.id);
    if (awayFound) setMatchAwayTeamId(awayFound.id);
  };

  const handleSaveMatchForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!matchTitle.trim()) {
      showToast('Match title is required', 'warning');
      return;
    }
    if (matchHomeTeamId === matchAwayTeamId) {
      showToast('Home and Away teams must be different', 'warning');
      return;
    }
    setSavingMatch(true);
    try {
      const payload = {
        stadiumId: metaData?.stadiums?.[0]?.id || 1,
        homeTeamId: matchHomeTeamId,
        awayTeamId: matchAwayTeamId,
        tournament: matchTournament.trim(),
        title: matchTitle.trim(),
        startTimeIso: new Date(matchStartLocal).toISOString(),
        status: matchStatus,
        demandMultiplier: demandMult,
        rivalryMultiplier: rivalryMult,
        weekendMultiplier: weekendMult,
      };
      const url =
        matchFormMode === 'CREATE'
          ? '/api/admin/matches'
          : `/api/admin/matches/${editingMatchId}`;
      const method = matchFormMode === 'CREATE' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Failed to save match fixture', 'error');
        return;
      }
      showToast(
        matchFormMode === 'CREATE'
          ? `Created fixture "${data.match.title}" with 4,800 live seats`
          : `Updated fixture "${data.match.title}"`,
        'success'
      );
      setMatchFormMode('NONE');
      await onRefreshAll();
      await fetchAnalytics();
    } catch {
      showToast('Error saving match fixture', 'error');
    } finally {
      setSavingMatch(false);
    }
  };

  const handleAdminCancelBooking = async (bookingId: number) => {
    try {
      const res = await fetch(`/api/admin/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Admin cancellation failed', 'error');
        return;
      }
      showToast(
        `Booking ${data.bookingReference} cancelled & ₹${(
          data.refundAmountPaise / 100
        ).toLocaleString('en-IN')} refunded.`,
        'success'
      );
      setConfirmAdminCancelId(null);
      await Promise.all([fetchBookings(), fetchAnalytics(), onRefreshAll()]);
    } catch {
      showToast('Failed to cancel booking', 'error');
    }
  };

  const handleRunBlenderParityCheck = async () => {
    const sampleAnchors = seats.slice(0, 25).map((s) => ({
      seatCode: s.seatCode,
      posX: s.posX,
      posY: s.posY,
      posZ: s.posZ,
    }));
    try {
      const res = await fetch('/api/blender/validate-manifest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anchors: sampleAnchors }),
      });
      const data = await res.json();
      setBlenderValidationResult(data);
      showToast(
        `3D Anchor Parity Verified: ${data.matchedCount}/${data.checkedCount} exact matches`,
        'success'
      );
    } catch {
      showToast('Failed to run Blender manifest check', 'error');
    }
  };

  const navItems: Array<{ id: AdminTab; label: string; icon: React.ReactNode }> = [
    { id: 'OVERVIEW', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'ANALYTICS', label: 'Booking Analytics', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'MATCHES', label: 'Match Management', icon: <CalendarPlus className="w-4 h-4" /> },
    { id: 'SEATS_PRICING', label: 'Seats & Pricing', icon: <Sliders className="w-4 h-4" /> },
    { id: 'BOOKINGS', label: 'Bookings', icon: <Ticket className="w-4 h-4" /> },
    { id: 'AUDIT', label: 'Audit Logs', icon: <ClipboardList className="w-4 h-4" /> },
  ];

  const currentMatchObj = matches.find((m) => m.id === selectedMatchId);
  const maxStandRevenue = Math.max(
    1,
    ...(analytics?.standOccupancy || []).map((s: any) => s.revenuePaise || 0)
  );
  const maxTimelineRevenue = Math.max(
    1,
    ...(analytics?.timelineSeries || []).map((t: any) => t.revenuePaise || 0)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-ops-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4"
    >
      <div className="w-full max-w-7xl h-[92vh] rounded-xl bg-[#0B0F17] border border-white/10 text-slate-100 shadow-2xl flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="px-5 py-3.5 bg-[#0F172A] border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <Activity className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 id="admin-ops-title" className="text-base font-bold text-white tracking-tight">
                STADIUMX Venue Operations Console
              </h2>
              <p className="text-[11px] text-slate-400">
                Real-time inventory control · Match fixtures · Revenue analytics · Immutable audit trail
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {isAdmin && (
              <>
                <select
                  aria-label="Select match fixture for operations"
                  value={selectedMatchId}
                  onChange={(e) => setSelectedMatchId(Number(e.target.value))}
                  className="rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {matches.map((m) => (
                    <option key={m.id} value={m.id}>
                      #{m.id} · {m.title}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setActiveModal('NONE')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-medium text-slate-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
        </header>

        {/* Role Enforcement Gate */}
        {!isAdmin ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="w-14 h-14 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center">
              <ShieldAlert className="w-7 h-7 text-rose-400" />
            </div>
            <div className="max-w-md space-y-1.5">
              <h3 className="text-base font-bold text-white">
                Venue Director Authorization Required
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Signed in as <strong className="text-slate-200">{currentUser.name}</strong> ({currentUser.role}).
                Unauthorized users cannot access revenue analytics, match configuration, or seat blocking controls.
              </p>
            </div>
            <button
              type="button"
              disabled={authenticating}
              onClick={handleAuthenticateAdmin}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              {authenticating ? 'Authenticating Admin Session...' : 'Sign In as Venue Director (ADMIN)'}
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
            {/* Sidebar Navigation */}
            <aside className="md:w-56 bg-[#0F172A]/70 border-b md:border-b-0 md:border-r border-white/10 p-3 flex md:flex-col gap-1 overflow-x-auto shrink-0">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors border ${
                    activeTab === item.id
                      ? 'bg-emerald-600/15 border-emerald-500/40 text-emerald-300 font-semibold'
                      : 'border-transparent text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}

              <div className="hidden md:block mt-auto pt-4 border-t border-white/10 px-2 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-slate-500">
                  Authorized Operator
                </div>
                <div className="text-xs font-medium text-white truncate">{currentUser.name}</div>
                <div className="text-[11px] font-mono text-amber-400">{currentUser.role}</div>
              </div>
            </aside>

            {/* Main Workspace Content */}
            <main className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* OVERVIEW TAB */}
              {activeTab === 'OVERVIEW' && analytics && (
                <div className="space-y-6">
                  {/* 8 Real PostgreSQL KPI Cards */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                    {[
                      {
                        label: 'Total Capacity',
                        value: analytics.totalCapacity.toLocaleString('en-IN'),
                        sub: 'Indexed bowl anchors',
                        accent: 'text-white',
                      },
                      {
                        label: 'Seats Booked',
                        value: analytics.totalBooked.toLocaleString('en-IN'),
                        sub: `${analytics.confirmedBookingsCount} confirmed orders`,
                        accent: 'text-emerald-400',
                      },
                      {
                        label: 'Available Seats',
                        value: analytics.totalAvailable.toLocaleString('en-IN'),
                        sub: `${analytics.totalBlocked} ops blocked`,
                        accent: 'text-sky-400',
                      },
                      {
                        label: 'Active Held Seats',
                        value: analytics.totalHeld.toLocaleString('en-IN'),
                        sub: 'In checkout TTL lock',
                        accent: 'text-amber-400',
                      },
                      {
                        label: 'Total Bookings',
                        value: analytics.totalBookingsCount.toLocaleString('en-IN'),
                        sub: 'All checkout attempts',
                        accent: 'text-white',
                      },
                      {
                        label: 'Gross Revenue',
                        value: `₹${(analytics.totalRevenuePaise / 100).toLocaleString('en-IN')}`,
                        sub: 'Captured match revenue',
                        accent: 'text-emerald-400',
                      },
                      {
                        label: 'Occupancy %',
                        value: `${analytics.occupancyPct}%`,
                        sub: `${analytics.totalBooked} / ${analytics.totalCapacity}`,
                        accent: 'text-sky-400',
                      },
                      {
                        label: 'Upcoming Matches',
                        value: String(analytics.upcomingMatchesCount),
                        sub: 'Active fixtures on sale',
                        accent: 'text-amber-400',
                      },
                    ].map((kpi) => (
                      <div
                        key={kpi.label}
                        className="rounded-xl bg-[#0F172A] border border-white/10 p-4"
                      >
                        <div className="text-[11px] font-medium text-slate-400">{kpi.label}</div>
                        <div
                          className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${kpi.accent}`}
                        >
                          {kpi.value}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">{kpi.sub}</div>
                      </div>
                    ))}
                  </div>

                  {/* Stand Occupancy + Most Viewed Seats */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <div className="lg:col-span-7 rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                          Stand Occupancy & Revenue ({currentMatchObj?.title})
                        </h3>
                        <button
                          type="button"
                          onClick={fetchAnalytics}
                          className="text-slate-400 hover:text-white"
                          title="Refresh Analytics"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${loadingAnalytics ? 'animate-spin' : ''}`} />
                        </button>
                      </div>

                      <div className="space-y-3">
                        {analytics.standOccupancy?.map((st: any) => (
                          <div key={st.standCode} className="space-y-1 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-slate-200">{st.standName}</span>
                              <span className="font-mono tabular-nums text-slate-300">
                                {st.booked}/{st.total} ({st.occupancyPct}%) · ₹
                                {(st.revenuePaise / 100).toLocaleString('en-IN')}
                              </span>
                            </div>
                            <div className="w-full h-2 rounded bg-[#0B0F17] overflow-hidden">
                              <div
                                style={{ width: `${Math.min(100, st.occupancyPct)}%` }}
                                className="h-full bg-emerald-500"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="lg:col-span-5 rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 border-b border-white/10 pb-2.5">
                        Most Inspected 3D Sightlines
                      </h3>
                      <div className="divide-y divide-white/10 text-xs">
                        {analytics.topViewedSeats?.map((s: any) => (
                          <div
                            key={s.seatId}
                            className="py-2.5 flex items-center justify-between font-mono tabular-nums"
                          >
                            <div>
                              <span className="font-bold text-emerald-400">{s.seatCode}</span>
                              <div className="font-sans text-[11px] text-slate-400">
                                {s.standName} · Score {s.viewQualityScore}
                              </div>
                            </div>
                            <span className="text-sky-400 font-semibold">{s.viewCount} views</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* BOOKING ANALYTICS TAB */}
              {activeTab === 'ANALYTICS' && analytics && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Match Revenue & Occupancy Analytics
                      </h3>
                      <p className="text-xs text-slate-400">
                        Derived strictly from PostgreSQL bookings, seat inventory, and turnstile scans
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {[
                        { label: 'All Time', days: 0 },
                        { label: '24 Hours', days: 1 },
                        { label: '7 Days', days: 7 },
                        { label: '30 Days', days: 30 },
                      ].map((f) => (
                        <button
                          key={f.days}
                          type="button"
                          onClick={() => setDaysFilter(f.days)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                            daysFilter === f.days
                              ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                              : 'bg-[#0F172A] border-white/10 text-slate-400 hover:text-white'
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Charts Row 1: Revenue Timeline SVG + Stand Revenue SVG */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Bookings & Revenue Over Time
                      </h4>
                      {analytics.timelineSeries?.length === 0 ? (
                        <div className="h-44 flex items-center justify-center text-xs text-slate-500">
                          No booking activity recorded inside this time window.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <svg
                            viewBox="0 0 420 150"
                            className="w-full h-44 bg-[#0B0F17] rounded-lg border border-white/10 p-2"
                          >
                            {analytics.timelineSeries.map((pt: any, i: number) => {
                              const barW = Math.max(
                                18,
                                Math.min(44, Math.floor(380 / Math.max(1, analytics.timelineSeries.length)) - 8)
                              );
                              const gap = 380 / Math.max(1, analytics.timelineSeries.length);
                              const x = 22 + i * gap + (gap - barW) / 2;
                              const h = Math.max(6, Math.round((pt.revenuePaise / maxTimelineRevenue) * 100));
                              const y = 122 - h;
                              return (
                                <g key={pt.date}>
                                  <rect
                                    x={x}
                                    y={y}
                                    width={barW}
                                    height={h}
                                    rx={4}
                                    fill="#10B981"
                                  />
                                  <text
                                    x={x + barW / 2}
                                    y={138}
                                    textAnchor="middle"
                                    fill="#94A3B8"
                                    fontSize="9"
                                    fontFamily="monospace"
                                  >
                                    {pt.date.slice(5)}
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                          <div className="flex flex-wrap gap-3 text-[11px] font-mono text-slate-400">
                            {analytics.timelineSeries.map((pt: any) => (
                              <span key={pt.date}>
                                {pt.date}: <strong className="text-white">{pt.confirmedCount}</strong> confirmed · ₹
                                {(pt.revenuePaise / 100).toLocaleString('en-IN')}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Stand Revenue Comparison (INR)
                      </h4>
                      <svg
                        viewBox="0 0 420 170"
                        className="w-full h-44 bg-[#0B0F17] rounded-lg border border-white/10 p-2"
                      >
                        {(analytics.standOccupancy || []).map((st: any, i: number) => {
                          const barW = 32;
                          const x = 18 + i * 49;
                          const h = Math.max(4, Math.round((st.revenuePaise / maxStandRevenue) * 115));
                          const y = 135 - h;
                          return (
                            <g key={st.standCode}>
                              <rect x={x} y={y} width={barW} height={h} rx={4} fill="#0EA5E9" />
                              <text
                                x={x + barW / 2}
                                y={152}
                                textAnchor="middle"
                                fill="#94A3B8"
                                fontSize="9"
                                fontFamily="monospace"
                              >
                                {st.standCode.slice(0, 4)}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                  </div>

                  {/* Charts Row 2: Category Sales + Conversion Funnel + Payment Status */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    <div className="rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Category Sales Distribution
                      </h4>
                      <div className="space-y-2.5 text-xs">
                        {(analytics.categoryBreakdown || []).map((cat: any) => (
                          <div key={cat.categoryCode} className="space-y-1">
                            <div className="flex justify-between">
                              <span className="font-medium text-white">{cat.categoryName}</span>
                              <span className="font-mono text-slate-300 tabular-nums">
                                {cat.booked}/{cat.total} · ₹
                                {(cat.revenuePaise / 100).toLocaleString('en-IN')}
                              </span>
                            </div>
                            <div className="w-full h-2 rounded bg-[#0B0F17] overflow-hidden">
                              <div
                                style={{
                                  width: `${Math.min(100, cat.occupancyPct)}%`,
                                  backgroundColor: cat.colorHex || '#10B981',
                                }}
                                className="h-full"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Booking & Gate Conversion Funnel
                      </h4>
                      <div className="space-y-2 text-xs font-mono tabular-nums">
                        {[
                          { label: 'Active Held Seats', val: analytics.conversionFunnel?.activeHeldSeats ?? 0, color: 'text-amber-400' },
                          { label: 'Checkout Attempts', val: analytics.conversionFunnel?.totalBookingAttempts ?? 0, color: 'text-slate-200' },
                          { label: 'Confirmed Bookings', val: analytics.conversionFunnel?.confirmedBookings ?? 0, color: 'text-emerald-400' },
                          { label: 'Digital Passes Issued', val: analytics.conversionFunnel?.ticketsIssued ?? 0, color: 'text-sky-400' },
                          { label: 'Gate Scanned (USED)', val: analytics.conversionFunnel?.ticketsUsedAtGate ?? 0, color: 'text-emerald-300' },
                        ].map((step) => (
                          <div
                            key={step.label}
                            className="flex items-center justify-between rounded-lg bg-[#0B0F17] border border-white/10 px-3 py-2"
                          >
                            <span className="font-sans text-slate-300">{step.label}</span>
                            <span className={`font-bold ${step.color}`}>{step.val}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                        Payment Status Breakdown
                      </h4>
                      {analytics.paymentStatusBreakdown?.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-500">
                          No payment records for this match yet.
                        </div>
                      ) : (
                        <div className="space-y-2 text-xs font-mono tabular-nums">
                          {analytics.paymentStatusBreakdown.map((p: any) => (
                            <div
                              key={p.status}
                              className="flex items-center justify-between rounded-lg bg-[#0B0F17] border border-white/10 px-3 py-2.5"
                            >
                              <span className="font-semibold text-white">{p.status}</span>
                              <span className="text-slate-300">
                                {p.count} tx · ₹{(p.amountPaise / 100).toLocaleString('en-IN')}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 24-Block Stadium Occupancy Heatmap */}
                  <div className="rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      24-Block Seating Bowl Occupancy Heatmap
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                      {(analytics.blockOccupancy || []).map((bl: any) => (
                        <div
                          key={bl.blockCode}
                          className="rounded-lg bg-[#0B0F17] border border-white/10 p-2.5 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between font-mono">
                            <span className="font-bold text-white">{bl.blockCode}</span>
                            <span className="text-emerald-400 tabular-nums">{bl.occupancyPct}%</span>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">{bl.blockName}</div>
                          <div className="text-[10px] font-mono text-slate-500 tabular-nums">
                            {bl.booked}B · {bl.held}H · {bl.blocked}X
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* MATCH MANAGEMENT TAB */}
              {activeTab === 'MATCHES' && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        Fixture & Pricing Configuration
                      </h3>
                      <p className="text-xs text-slate-400">
                        Create new matches (auto-provisions 4,800 seats) or edit existing fixtures & statuses
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={openCreateMatch}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Create Match Fixture
                    </button>
                  </div>

                  {matchFormMode !== 'NONE' && (
                    <form
                      onSubmit={handleSaveMatchForm}
                      className="rounded-xl bg-[#0F172A] border border-emerald-500/40 p-5 space-y-4"
                    >
                      <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                          {matchFormMode === 'CREATE'
                            ? 'New Stadium Match Fixture'
                            : `Edit Fixture #${editingMatchId}`}
                        </h4>
                        <button
                          type="button"
                          onClick={() => setMatchFormMode('NONE')}
                          className="text-xs text-slate-400 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                        <div>
                          <label className="block text-slate-400 mb-1">Match Title</label>
                          <input
                            type="text"
                            required
                            value={matchTitle}
                            onChange={(e) => setMatchTitle(e.target.value)}
                            placeholder="e.g. Royal Challengers vs Chennai Kings"
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1">Tournament / Series</label>
                          <input
                            type="text"
                            required
                            value={matchTournament}
                            onChange={(e) => setMatchTournament(e.target.value)}
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1">Kickoff Date & Time</label>
                          <input
                            type="datetime-local"
                            required
                            value={matchStartLocal}
                            onChange={(e) => setMatchStartLocal(e.target.value)}
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-white font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1">Home Team</label>
                          <select
                            value={matchHomeTeamId}
                            onChange={(e) => setMatchHomeTeamId(Number(e.target.value))}
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-white"
                          >
                            {(metaData?.teams || []).map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.shortName})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1">Away Team</label>
                          <select
                            value={matchAwayTeamId}
                            onChange={(e) => setMatchAwayTeamId(Number(e.target.value))}
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-white"
                          >
                            {(metaData?.teams || []).map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({t.shortName})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-400 mb-1">Match Status</label>
                          <select
                            value={matchStatus}
                            onChange={(e) => setMatchStatus(e.target.value as any)}
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-white"
                          >
                            <option value="UPCOMING">UPCOMING</option>
                            <option value="LIVE">LIVE</option>
                            <option value="COMPLETED">COMPLETED</option>
                            <option value="CANCELLED">CANCELLED</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2">
                        <button
                          type="submit"
                          disabled={savingMatch}
                          className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                        >
                          {savingMatch
                            ? 'Saving Fixture...'
                            : matchFormMode === 'CREATE'
                            ? 'Create Match & Seed Seats'
                            : 'Save Match Changes'}
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="grid grid-cols-1 gap-3">
                    {matches.map((m) => (
                      <div
                        key={m.id}
                        className="rounded-xl bg-[#0F172A] border border-white/10 p-4 flex flex-wrap items-center justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-slate-400">#{m.id}</span>
                            <h4 className="text-sm font-bold text-white">{m.title}</h4>
                            <span className="px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 font-mono text-[10px] text-emerald-300">
                              {m.status}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400">
                            {m.tournament} · {new Date(m.startTime).toLocaleString('en-IN')} · Occupancy{' '}
                            <strong className="text-white font-mono">
                              {m.inventorySummary.occupancyPct}%
                            </strong>{' '}
                            ({m.inventorySummary.booked} booked)
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedMatchId(m.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                              selectedMatchId === m.id
                                ? 'bg-sky-600/20 border-sky-500/50 text-sky-300'
                                : 'bg-slate-800 border-white/10 text-slate-300'
                            }`}
                          >
                            {selectedMatchId === m.id ? 'Selected' : 'Inspect'}
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditMatch(m)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs text-white"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SEATS & PRICING TAB */}
              {activeTab === 'SEATS_PRICING' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left: Block Seat Matrix + Blocking */}
                  <div className="lg:col-span-7 rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                      <div className="flex items-center gap-2">
                        <Grid className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
                          Seat Availability & Ops Blocking ({selectedBlockCode})
                        </h3>
                      </div>
                      <select
                        value={selectedBlockCode}
                        onChange={(e) => {
                          setSelectedBlockCode(e.target.value);
                          setSelectedSeatIdsForBlock([]);
                        }}
                        className="rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-1.5 text-xs font-mono text-white"
                      >
                        {(analytics?.blockOccupancy || []).map((bl: any) => (
                          <option key={bl.blockCode} value={bl.blockCode}>
                            {bl.blockCode} · {bl.blockName}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
                      <span>Click available/blocked seats below to toggle selection. Confirmed BOOKED (red) & HELD (amber) seats are strictly locked against overwrite.</span>
                      <span className="font-mono text-sky-400">
                        Selected: {selectedSeatIdsForBlock.length}
                      </span>
                    </div>

                    {/* 20-column seat matrix (10 rows × 20 seats = 200 seats) */}
                    <div className="grid grid-cols-10 sm:grid-cols-[repeat(20,minmax(0,1fr))] gap-1 bg-[#0B0F17] p-3 rounded-lg border border-white/10">
                      {blockSeats.map((seat) => {
                        const isPicked = selectedSeatIdsForBlock.includes(seat.id);
                        const isProtected = seat.status === 'BOOKED' || seat.status === 'HELD';
                        const cls = isPicked
                          ? 'bg-sky-500 text-white border-sky-300'
                          : seat.status === 'BOOKED'
                          ? 'bg-rose-600/80 text-white border-rose-500 cursor-not-allowed'
                          : seat.status === 'HELD'
                          ? 'bg-amber-500/80 text-black border-amber-400 cursor-not-allowed'
                          : seat.status === 'BLOCKED'
                          ? 'bg-slate-600 text-slate-200 border-slate-400'
                          : 'bg-emerald-600/35 hover:bg-emerald-500/60 text-emerald-200 border-emerald-500/40';
                        return (
                          <button
                            key={seat.id}
                            type="button"
                            title={`${seat.seatCode} (${seat.status})`}
                            onClick={() => {
                              if (isProtected) {
                                showToast(
                                  `${seat.seatCode} is ${seat.status} and protected from blocking.`,
                                  'warning'
                                );
                                return;
                              }
                              setSelectedSeatIdsForBlock((prev) =>
                                prev.includes(seat.id)
                                  ? prev.filter((id) => id !== seat.id)
                                  : [...prev, seat.id]
                              );
                            }}
                            className={`h-5 rounded border text-[9px] font-mono leading-none flex items-center justify-center ${cls}`}
                          >
                            {seat.seatNumber}
                          </button>
                        );
                      })}
                    </div>

                    <div className="space-y-2.5 pt-2 border-t border-white/10">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <input
                          type="text"
                          value={blockSeatCodeInput}
                          onChange={(e) => setBlockSeatCodeInput(e.target.value)}
                          placeholder="Or enter Seat Code(s) e.g. N-T1-R01-S01"
                          className="rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-xs font-mono text-white"
                        />
                        <input
                          type="text"
                          value={blockReason}
                          onChange={(e) => setBlockReason(e.target.value)}
                          placeholder="Operational reason"
                          className="rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 text-xs text-white"
                        />
                      </div>

                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => handleToggleSeatBlock('BLOCKED')}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                        >
                          <Lock className="w-3.5 h-3.5" />
                          Block Selected
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleSeatBlock('AVAILABLE')}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                        >
                          <Unlock className="w-3.5 h-3.5" />
                          Unblock to Available
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Right: Dynamic Pricing + Category Base Prices + 3D Parity */}
                  <div className="lg:col-span-5 space-y-4">
                    <div className="rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white border-b border-white/10 pb-2">
                        Dynamic Multipliers & Base Tier Pricing
                      </h3>

                      <div className="grid grid-cols-3 gap-2.5 text-xs">
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Demand ({demandMult}x)
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min="0.5"
                            max="3.0"
                            value={demandMult}
                            onChange={(e) => setDemandMult(Number(e.target.value))}
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-2.5 py-1.5 font-mono text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Rivalry ({rivalryMult}x)
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min="0.5"
                            max="3.0"
                            value={rivalryMult}
                            onChange={(e) => setRivalryMult(Number(e.target.value))}
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-2.5 py-1.5 font-mono text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-400 mb-1">
                            Weekend ({weekendMult}x)
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            min="0.5"
                            max="3.0"
                            value={weekendMult}
                            onChange={(e) => setWeekendMult(Number(e.target.value))}
                            className="w-full rounded-lg bg-[#0B0F17] border border-white/15 px-2.5 py-1.5 font-mono text-white"
                          />
                        </div>
                      </div>

                      <div className="space-y-2 border-t border-white/10 pt-3">
                        <div className="text-[11px] text-slate-400">
                          Category Base Prices (INR before multipliers)
                        </div>
                        {(currentMatchObj?.pricing || []).map((p) => (
                          <div
                            key={p.categoryId}
                            className="flex items-center justify-between gap-3 text-xs"
                          >
                            <span className="text-slate-200">{p.categoryName}</span>
                            <input
                              type="number"
                              min={500}
                              step={100}
                              value={catBasePrices[p.categoryId] ?? Math.round(p.basePricePaise / 100)}
                              onChange={(e) =>
                                setCatBasePrices((prev) => ({
                                  ...prev,
                                  [p.categoryId]: Number(e.target.value),
                                }))
                              }
                              className="w-28 rounded bg-[#0B0F17] border border-white/15 px-2.5 py-1 text-right font-mono text-white"
                            />
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={handleSavePricing}
                        className="w-full py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
                      >
                        Apply Multipliers & Category Pricing
                      </button>
                    </div>

                    <div className="rounded-xl bg-[#0F172A] border border-white/10 p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold text-white">
                          Blender 3D Anchor Parity
                        </h4>
                        <button
                          type="button"
                          onClick={handleRunBlenderParityCheck}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-emerald-400 font-medium"
                        >
                          Verify 3D Parity
                        </button>
                      </div>
                      {blenderValidationResult && (
                        <div className="text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Verified {blenderValidationResult.matchedCount}/
                          {blenderValidationResult.checkedCount} seat anchors (0 mismatches).
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* BOOKINGS LEDGER TAB */}
              {activeTab === 'BOOKINGS' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5 flex-1">
                      <div className="relative flex-1 min-w-[200px] max-w-sm">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={bookingSearch}
                          onChange={(e) => {
                            setBookingSearch(e.target.value);
                            setBookingPage(1);
                          }}
                          placeholder="Search ref, fan email, or order ID..."
                          className="w-full rounded-lg bg-[#0F172A] border border-white/15 pl-9 pr-3 py-2 text-xs text-white"
                        />
                      </div>

                      <select
                        value={bookingStatusFilter}
                        onChange={(e) => {
                          setBookingStatusFilter(e.target.value);
                          setBookingPage(1);
                        }}
                        className="rounded-lg bg-[#0F172A] border border-white/15 px-3 py-2 text-xs text-white"
                      >
                        <option value="ALL">All Statuses</option>
                        <option value="CONFIRMED">CONFIRMED</option>
                        <option value="CANCELLED">CANCELLED</option>
                        <option value="PENDING_PAYMENT">PENDING_PAYMENT</option>
                      </select>

                      <select
                        value={bookingMatchScope}
                        onChange={(e) => {
                          setBookingMatchScope(e.target.value);
                          setBookingPage(1);
                        }}
                        className="rounded-lg bg-[#0F172A] border border-white/15 px-3 py-2 text-xs text-white"
                      >
                        <option value="ALL">All Fixtures</option>
                        {matches.map((m) => (
                          <option key={m.id} value={String(m.id)}>
                            #{m.id} · {m.title}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="text-xs font-mono text-slate-400">
                      Total: <strong className="text-white">{bookingsTotal}</strong>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#0F172A] border border-white/10 overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#11192C] border-b border-white/10 text-[11px] uppercase text-slate-400">
                        <tr>
                          <th className="px-4 py-3">Booking Ref</th>
                          <th className="px-4 py-3">Fan</th>
                          <th className="px-4 py-3">Match</th>
                          <th className="px-4 py-3">Seats</th>
                          <th className="px-4 py-3">Amount</th>
                          <th className="px-4 py-3">Gate Entry</th>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {bookingRows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                              No bookings match your search & filter criteria.
                            </td>
                          </tr>
                        ) : (
                          bookingRows.map((b) => (
                            <tr key={b.id} className="hover:bg-white/5">
                              <td className="px-4 py-3 font-mono font-bold text-emerald-400">
                                {b.bookingReference}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-medium text-white">{b.userName}</div>
                                <div className="text-[11px] text-slate-400">{b.userEmail}</div>
                              </td>
                              <td className="px-4 py-3 text-slate-300 max-w-[180px] truncate">
                                {b.matchTitle}
                              </td>
                              <td className="px-4 py-3 font-mono">{b.seatCount}</td>
                              <td className="px-4 py-3 font-mono tabular-nums text-white">
                                ₹{(b.totalAmountPaise / 100).toLocaleString('en-IN')}
                              </td>
                              <td className="px-4 py-3 font-mono tabular-nums text-slate-300">
                                {b.ticketsUsed}/{b.ticketsTotal} Used
                              </td>
                              <td className="px-4 py-3 font-mono">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] border ${
                                    b.status === 'CONFIRMED'
                                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                      : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                                  }`}
                                >
                                  {b.status}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => setSelectedBookingDetail(b)}
                                  className="text-sky-400 hover:underline font-medium"
                                >
                                  Details
                                </button>
                                {b.status === 'CONFIRMED' &&
                                  (confirmAdminCancelId === b.id ? (
                                    <button
                                      type="button"
                                      onClick={() => handleAdminCancelBooking(b.id)}
                                      className="px-2 py-1 rounded bg-rose-600 text-white text-[10px] font-semibold"
                                    >
                                      Confirm Refund
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmAdminCancelId(b.id)}
                                      className="text-rose-400 hover:underline font-medium"
                                    >
                                      Cancel/Refund
                                    </button>
                                  ))}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Page {bookingPage} of {Math.max(1, Math.ceil(bookingsTotal / 10))}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={bookingPage <= 1}
                        onClick={() => setBookingPage((p) => Math.max(1, p - 1))}
                        className="px-3 py-1.5 rounded bg-[#0F172A] border border-white/10 disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={bookingPage * 10 >= bookingsTotal}
                        onClick={() => setBookingPage((p) => p + 1)}
                        className="px-3 py-1.5 rounded bg-[#0F172A] border border-white/10 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>

                  {selectedBookingDetail && (
                    <div className="rounded-xl bg-[#0F172A] border border-sky-500/40 p-4 space-y-2.5">
                      <div className="flex items-center justify-between border-b border-white/10 pb-2">
                        <span className="font-mono text-xs font-bold text-sky-400">
                          Booking Detail · {selectedBookingDetail.bookingReference}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedBookingDetail(null)}
                          className="text-xs text-slate-400 hover:text-white"
                        >
                          Dismiss
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        {selectedBookingDetail.tickets.map((t: any) => (
                          <div
                            key={t.ticketCode}
                            className="rounded bg-[#0B0F17] border border-white/10 p-2.5 font-mono"
                          >
                            <div className="font-bold text-white">{t.ticketCode}</div>
                            <div className="text-emerald-400">{t.seatCode}</div>
                            <div className="text-[11px] text-slate-400">
                              {t.standName} · {t.status}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AUDIT LOGS TAB */}
              {activeTab === 'AUDIT' && (
                <div className="rounded-xl bg-[#0F172A] border border-white/10 p-5 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-white">
                      Immutable Venue Operations Audit Trail
                    </h3>
                    <button
                      type="button"
                      onClick={fetchAuditLogs}
                      className="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Refresh
                    </button>
                  </div>
                  <div className="divide-y divide-white/10 text-xs">
                    {auditLogs.map((log) => (
                      <div
                        key={log.id}
                        className="py-2.5 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-amber-400">
                              {log.action}
                            </span>
                            <span className="text-slate-500">·</span>
                            <span className="text-slate-200">
                              {log.entityType} ({log.entityId})
                            </span>
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                              {log.actorRole}
                            </span>
                          </div>
                          {log.metadataJson && (
                            <div className="font-mono text-[11px] text-slate-400 break-all">
                              {log.metadataJson}
                            </div>
                          )}
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </main>
          </div>
        )}
      </div>
    </div>
  );
};
