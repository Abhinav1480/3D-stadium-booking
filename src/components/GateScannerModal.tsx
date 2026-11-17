import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  CheckCircle2,
  History,
  KeyRound,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { useStadiumStore } from '../store/useStadiumStore';
import {
  decodeQrFromFile,
  decodeQrFromImageSrc,
  decodeQrFromVideoFrame,
  generateQrDataUrl,
} from '../utils/qrClient';
import { soundEngine } from '../utils/soundEngine';

interface GatePassItem {
  id: number;
  ticketCode: string;
  matchId: number;
  matchTitle: string;
  status: string;
  scannedAt: string | null;
  seatCode: string;
  standName: string;
  blockName: string;
  rowNumber: number;
  seatNumber: number;
  attendeeName: string;
  qrDataUrl: string;
}

interface GateScanLogItem {
  id: number;
  result: string;
  details: string;
  scannedAt: string;
  matchId: number | null;
  ticketCode: string | null;
  seatCode: string | null;
  standName: string | null;
}

interface GateValidationResponse {
  valid: boolean;
  status: string;
  message: string;
  details?: {
    ticketCode?: string;
    bookingReference?: string;
    matchId?: number;
    matchTitle?: string;
    seatCode?: string;
    standName?: string;
    blockName?: string;
    categoryName?: string;
    rowNumber?: number;
    seatNumber?: number;
    attendeeName?: string;
    paymentStatus?: string;
    bookingStatus?: string;
    scannedAt?: string;
    previousScannedAt?: string | null;
  };
}

export const GateScannerModal: React.FC = () => {
  const activeModal = useStadiumStore((s) => s.activeModal);
  const setActiveModal = useStadiumStore((s) => s.setActiveModal);
  const activeMatchId = useStadiumStore((s) => s.activeMatchId);
  const matches = useStadiumStore((s) => s.matches);
  const currentUser = useStadiumStore((s) => s.currentUser);
  const sessionToken = useStadiumStore((s) => s.sessionToken);
  const setUserSession = useStadiumStore((s) => s.setUserSession);
  const showToast = useStadiumStore((s) => s.showToast);

  const [gateMatchId, setGateMatchId] = useState<number>(activeMatchId);
  const [showAllMatchesPasses, setShowAllMatchesPasses] = useState<boolean>(false);
  const [passes, setPasses] = useState<GatePassItem[]>([]);
  const [scanLogs, setScanLogs] = useState<GateScanLogItem[]>([]);
  const [loadingQueue, setLoadingQueue] = useState<boolean>(false);

  const [manualTicketRef, setManualTicketRef] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [authenticating, setAuthenticating] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<GateValidationResponse | null>(null);

  // Camera state
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastDecodedRef = useRef<{ value: string; time: number }>({ value: '', time: 0 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isAuthorizedGateRole =
    currentUser.role === 'GATE_STAFF' || currentUser.role === 'ADMIN';

  const authHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }
    return headers;
  }, [sessionToken]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const loadGateData = useCallback(async () => {
    if (!isAuthorizedGateRole || !sessionToken) return;
    setLoadingQueue(true);
    try {
      const passQuery = showAllMatchesPasses ? '' : `?matchId=${gateMatchId}`;
      const [passRes, logRes] = await Promise.all([
        fetch(`/api/gate/passes${passQuery}`, { headers: authHeaders() }),
        fetch(`/api/gate/scan-logs?matchId=${gateMatchId}`, { headers: authHeaders() }),
      ]);
      if (passRes.ok) {
        const passData = await passRes.json();
        setPasses(passData.passes || []);
      }
      if (logRes.ok) {
        const logData = await logRes.json();
        setScanLogs(logData.scanLogs || []);
      }
    } catch {
      // Quietly handle transient fetch errors
    } finally {
      setLoadingQueue(false);
    }
  }, [isAuthorizedGateRole, sessionToken, showAllMatchesPasses, gateMatchId, authHeaders]);

  useEffect(() => {
    if (activeModal === 'GATE_QR') {
      setGateMatchId(activeMatchId);
      setScanResult(null);
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [activeModal, activeMatchId, stopCamera]);

  useEffect(() => {
    if (activeModal === 'GATE_QR' && isAuthorizedGateRole && sessionToken) {
      loadGateData();
    }
  }, [activeModal, isAuthorizedGateRole, sessionToken, loadGateData]);

  const validateAgainstBackend = useCallback(
    async (payload: { qrToken?: string; ticketCode?: string }) => {
      setSubmitting(true);
      try {
        const res = await fetch('/api/gate/validate-qr', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            ...payload,
            expectedMatchId: gateMatchId,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Turnstile verification failed', 'error');
          return;
        }
        setScanResult(data);
        if (data.valid) {
          soundEngine.playChime('ticket');
        } else {
          soundEngine.playChime('select');
        }
        await loadGateData();
      } catch {
        showToast('Network error communicating with turnstile gate service', 'error');
      } finally {
        setSubmitting(false);
      }
    },
    [authHeaders, gateMatchId, loadGateData, showToast]
  );

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Camera API unavailable in this browser context. Use Upload QR Image or Scan Pass Queue.'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      const tick = () => {
        if (!videoRef.current || !streamRef.current) return;
        if (!scratchCanvasRef.current) {
          scratchCanvasRef.current = document.createElement('canvas');
        }
        const decoded = decodeQrFromVideoFrame(videoRef.current, scratchCanvasRef.current);
        if (decoded) {
          const now = Date.now();
          if (
            decoded !== lastDecodedRef.current.value ||
            now - lastDecodedRef.current.time > 2500
          ) {
            lastDecodedRef.current = { value: decoded, time: now };
            validateAgainstBackend({ qrToken: decoded });
            stopCamera();
            return;
          }
        }
        rafRef.current = window.requestAnimationFrame(tick);
      };
      rafRef.current = window.requestAnimationFrame(tick);
    } catch (err: any) {
      const msg =
        err?.name === 'NotAllowedError'
          ? 'Camera access was denied. Enable camera permissions in browser settings and retry.'
          : 'No active camera feed detected. Connect a webcam or use QR image upload below.';
      setCameraError(msg);
      setCameraActive(false);
    }
  };

  const handleUploadQrImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const decoded = await decodeQrFromFile(file);
    if (!decoded) {
      setScanResult({
        valid: false,
        status: 'UNREADABLE_QR',
        message: `Could not detect a valid QR code in "${file.name}". Ensure high contrast and retry.`,
      });
      return;
    }
    await validateAgainstBackend({ qrToken: decoded });
  };

  const handleScanRenderedPassQr = async (pass: GatePassItem) => {
    const decoded = await decodeQrFromImageSrc(pass.qrDataUrl);
    if (!decoded) {
      showToast('Failed to decode rendered QR image canvas', 'error');
      return;
    }
    await validateAgainstBackend({ qrToken: decoded });
  };

  const handleTestTamperedQr = async () => {
    const forgedPayload = `STX1.eyJ0aWNrZXRDb2RlIjoiRkFLRS05OSIsIm1hdGNoSWQiOjF9.tampered_sig_${Date.now()}`;
    const forgedQrPng = await generateQrDataUrl(forgedPayload);
    const decoded = await decodeQrFromImageSrc(forgedQrPng);
    if (decoded) {
      await validateAgainstBackend({ qrToken: decoded });
    }
  };

  const handleAuthenticateGateStaff = async () => {
    setAuthenticating(true);
    try {
      const res = await fetch('/api/auth/switch-role', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ role: 'GATE_STAFF' }),
      });
      const data = await res.json();
      if (res.ok && data.user && data.token) {
        setUserSession(data.user, data.token);
        showToast('Signed in as Gate 1 Turnstile Staff', 'success');
      } else {
        showToast(data.error || 'Gate authentication failed', 'error');
      }
    } catch {
      showToast('Network error during Gate Staff sign-in', 'error');
    } finally {
      setAuthenticating(false);
    }
  };

  if (activeModal !== 'GATE_QR') return null;

  const activeGateMatch = matches.find((m) => m.id === gateMatchId);

  const renderStatusStyle = (status: string) => {
    if (status === 'VALID') {
      return {
        wrap: 'bg-emerald-950/70 border-emerald-500/60 text-emerald-100',
        badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        title: 'ENTRY GRANTED · TURNSTILE UNLOCKED',
        icon: <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />,
      };
    }
    if (status === 'WRONG_MATCH' || status === 'DUPLICATE_SCAN') {
      return {
        wrap: 'bg-amber-950/70 border-amber-500/60 text-amber-100',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        title:
          status === 'DUPLICATE_SCAN'
            ? 'ALREADY USED · DUPLICATE ENTRY BLOCKED'
            : 'WRONG MATCH · GATE MISMATCH',
        icon: <AlertTriangle className="w-6 h-6 text-amber-400 shrink-0" />,
      };
    }
    return {
      wrap: 'bg-rose-950/75 border-rose-500/60 text-rose-100',
      badge: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
      title: 'ENTRY REJECTED · INVALID PASS',
      icon: <XCircle className="w-6 h-6 text-rose-400 shrink-0" />,
    };
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gate-scanner-title"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-5"
    >
      <div className="w-full max-w-6xl rounded-xl bg-[#0B0F17] border border-white/10 text-slate-100 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#0F172A] border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
              <QrCode className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2
                id="gate-scanner-title"
                className="text-base sm:text-lg font-bold tracking-tight text-white"
              >
                STADIUMX Gate Turnstile Validator
              </h2>
              <p className="text-xs text-slate-400">
                Live camera QR decoder · Image verification · Single-entry cryptographic turnstile enforcement
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isAuthorizedGateRole && (
              <div className="flex items-center gap-2">
                <label htmlFor="gate-match-select" className="text-xs text-slate-400 hidden sm:inline">
                  Gate Fixture:
                </label>
                <select
                  id="gate-match-select"
                  value={gateMatchId}
                  onChange={(e) => {
                    setGateMatchId(Number(e.target.value));
                    setScanResult(null);
                  }}
                  className="rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  {matches.map((m) => (
                    <option key={m.id} value={m.id}>
                      #{m.id} · {m.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                stopCamera();
                setActiveModal('NONE');
              }}
              aria-label="Close Gate Scanner"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-medium text-slate-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
        </div>

        {/* Role Gate Check */}
        {!isAuthorizedGateRole ? (
          <div className="p-8 sm:p-12 flex flex-col items-center justify-center text-center space-y-4">
            <div className="w-14 h-14 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <ShieldAlert className="w-7 h-7 text-amber-400" />
            </div>
            <div className="max-w-md space-y-1.5">
              <h3 className="text-base font-bold text-white">
                Turnstile Staff Authorization Required
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Signed in as <strong className="text-slate-200">{currentUser.name}</strong> ({currentUser.role}).
                Gate turnstile QR validation and entry ledger access require <code className="font-mono text-emerald-400">GATE_STAFF</code> or <code className="font-mono text-emerald-400">ADMIN</code> clearance.
              </p>
            </div>
            <button
              type="button"
              disabled={authenticating}
              onClick={handleAuthenticateGateStaff}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              {authenticating ? 'Authorizing Turnstile Session...' : 'Authorize as Gate 1 Staff'}
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* LEFT COLUMN: Camera + Image Decoder + Manual Reference */}
            <div className="lg:col-span-5 space-y-4">
              {/* Camera Viewport Card */}
              <div className="rounded-xl bg-[#0F172A] border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ScanLine className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                      Optical Camera Scanner
                    </h3>
                  </div>
                  <div className="flex items-center gap-2">
                    {!cameraActive ? (
                      <button
                        type="button"
                        onClick={startCamera}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        Start Camera
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors"
                      >
                        <CameraOff className="w-3.5 h-3.5" />
                        Stop Camera
                      </button>
                    )}
                  </div>
                </div>

                {/* Camera Preview Frame */}
                <div className="relative aspect-[4/3] w-full rounded-lg bg-[#06090F] border border-white/10 overflow-hidden flex items-center justify-center">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
                  />
                  {cameraActive ? (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="w-44 h-44 rounded-xl border-2 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(6,9,15,0.45)]" />
                    </div>
                  ) : (
                    <div className="p-6 text-center space-y-2.5 max-w-xs">
                      <QrCode className="w-10 h-10 text-slate-600 mx-auto" />
                      {cameraError ? (
                        <div className="space-y-2">
                          <p className="text-xs text-amber-300 leading-relaxed">{cameraError}</p>
                          <button
                            type="button"
                            onClick={startCamera}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/15 text-xs text-white"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Retry Camera
                          </button>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400">
                          Activate device camera to scan attendee QR passes at Turnstile Gate, or upload a QR image / scan active match passes on the right.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Image Upload & Tampered Check */}
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleUploadQrImage}
                    className="hidden"
                  />
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-medium text-slate-200 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5 text-sky-400" />
                    Upload QR Image
                  </button>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleTestTamperedQr}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-950/60 hover:bg-rose-900/70 border border-rose-500/30 text-xs font-medium text-rose-200 transition-colors"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                    Test Forged QR
                  </button>
                </div>
              </div>

              {/* Manual Authorized Ticket Reference Fallback */}
              <div className="rounded-xl bg-[#0F172A] border border-white/10 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-sky-400" />
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                      Turnstile Reference Fallback
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-slate-400">Gate Staff Only</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  For cracked screens or glare where optical scan fails: enter the printed human-readable Ticket Code. Server cryptographic, match, payment, and single-use checks still apply.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!manualTicketRef.trim()) {
                      showToast('Enter a ticket reference code (e.g. TKT-...)', 'warning');
                      return;
                    }
                    validateAgainstBackend({ ticketCode: manualTicketRef.trim() });
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    id="manual-ticket-ref-input"
                    type="text"
                    value={manualTicketRef}
                    onChange={(e) => setManualTicketRef(e.target.value)}
                    placeholder="TKT-..."
                    className="flex-1 rounded-lg bg-[#0B0F17] border border-white/15 px-3 py-2 font-mono text-xs text-white uppercase placeholder:normal-case placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                  />
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                  >
                    {submitting ? 'Checking...' : 'Verify Code'}
                  </button>
                </form>
              </div>
            </div>

            {/* RIGHT COLUMN: Validation Result + Real Scannable QR Queue + History */}
            <div className="lg:col-span-7 space-y-4">
              {/* Verification Result Panel */}
              {scanResult ? (
                (() => {
                  const st = renderStatusStyle(scanResult.status);
                  return (
                    <div
                      data-testid="gate-scan-result"
                      className={`rounded-xl border p-4 space-y-3 ${st.wrap}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {st.icon}
                          <div>
                            <div className="text-xs font-bold tracking-wider uppercase">
                              {st.title}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed opacity-95">
                              {scanResult.message}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-1 rounded border text-[11px] font-mono font-bold shrink-0 ${st.badge}`}
                        >
                          {scanResult.status}
                        </span>
                      </div>

                      {scanResult.details && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2.5 border-t border-white/15 text-xs">
                          <div>
                            <div className="text-[10px] uppercase text-slate-300/70">Seat</div>
                            <div className="font-mono font-bold text-white">
                              {scanResult.details.seatCode}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase text-slate-300/70">Stand & Block</div>
                            <div className="font-medium text-white truncate">
                              {scanResult.details.standName}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase text-slate-300/70">Attendee</div>
                            <div className="font-medium text-white truncate">
                              {scanResult.details.attendeeName}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] uppercase text-slate-300/70">
                              {scanResult.details.previousScannedAt ? 'First Scanned' : 'Ticket Ref'}
                            </div>
                            <div className="font-mono text-white truncate">
                              {scanResult.details.previousScannedAt
                                ? new Date(scanResult.details.previousScannedAt).toLocaleTimeString()
                                : scanResult.details.ticketCode}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()
              ) : (
                <div className="rounded-xl bg-[#0F172A] border border-white/10 p-4 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-white">
                      Turnstile Ready · {activeGateMatch?.title || `Match #${gateMatchId}`}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Awaiting optical QR scan or manual turnstile check.
                    </div>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 rounded">
                    GATE ARMED
                  </span>
                </div>
              )}

              {/* Active Rendered QR Pass Queue */}
              <div className="rounded-xl bg-[#0F172A] border border-white/10 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2.5">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                      Scannable Digital QR Passes ({passes.length})
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Each pass renders an actual machine-readable QR image decoded client-side before gate verification.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showAllMatchesPasses}
                        onChange={(e) => setShowAllMatchesPasses(e.target.checked)}
                        className="accent-emerald-500"
                      />
                      Include other matches (test Wrong-Match)
                    </label>
                    <button
                      type="button"
                      onClick={loadGateData}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-300"
                      title="Refresh QR Passes"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingQueue ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {passes.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    No issued tickets found for this fixture yet. Book a seat in the 3D stadium or enable "Include other matches" to scan another fixture pass.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-1">
                    {passes.map((pass) => (
                      <div
                        key={pass.id}
                        data-testid={`gate-pass-card-${pass.ticketCode}`}
                        className="rounded-lg bg-[#0B0F17] border border-white/10 p-3 flex items-center gap-3"
                      >
                        <img
                          src={pass.qrDataUrl}
                          alt={`QR pass ${pass.ticketCode}`}
                          className="w-20 h-20 rounded bg-white p-1 shrink-0 border border-white/20"
                        />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-xs font-bold text-white truncate">
                              {pass.ticketCode}
                            </span>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                                pass.status === 'VALID'
                                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                                  : pass.status === 'USED'
                                  ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                                  : 'text-rose-300 border-rose-500/40 bg-rose-500/10'
                              }`}
                            >
                              {pass.status}
                            </span>
                          </div>
                          <div className="text-[11px] font-medium text-sky-400 truncate">
                            {pass.seatCode} · {pass.standName}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate">
                            {pass.matchTitle}
                          </div>
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleScanRenderedPassQr(pass)}
                            className="mt-1 w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded bg-emerald-600/90 hover:bg-emerald-500 text-white text-[11px] font-semibold transition-colors"
                          >
                            <ScanLine className="w-3 h-3" />
                            Scan QR Image
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent Gate Scan History */}
              <div className="rounded-xl bg-[#0F172A] border border-white/10 p-4 space-y-2.5">
                <div className="flex items-center gap-2 border-b border-white/10 pb-2">
                  <History className="w-4 h-4 text-slate-400" />
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                    Recent Turnstile Scan Ledger
                  </h3>
                </div>
                {scanLogs.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-500">
                    No turnstile scan attempts recorded for this fixture yet.
                  </div>
                ) : (
                  <div className="divide-y divide-white/10 max-h-44 overflow-y-auto text-xs">
                    {scanLogs.map((log) => (
                      <div
                        key={log.id}
                        className="py-2 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                log.result === 'VALID'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : log.result === 'DUPLICATE_SCAN' || log.result === 'WRONG_MATCH'
                                  ? 'bg-amber-500/15 text-amber-400'
                                  : 'bg-rose-500/15 text-rose-400'
                              }`}
                            >
                              {log.result}
                            </span>
                            {log.ticketCode && (
                              <span className="font-mono text-white font-medium">
                                {log.ticketCode}
                              </span>
                            )}
                            {log.seatCode && (
                              <span className="text-slate-400 font-mono">({log.seatCode})</span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate mt-0.5">
                            {log.details}
                          </div>
                        </div>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0 tabular-nums">
                          {new Date(log.scannedAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
