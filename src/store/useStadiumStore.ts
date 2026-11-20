import { create } from 'zustand';
import type {
  StadiumHotspot,
  StadiumSpec,
  ViewTelemetryBreakdown,
} from '../shared/stadiumSpec';
import { getInitialQualityPreset, resolveSeatAvailabilityStatus } from '../shared/seatingSpatial';

export interface StaticSeatRecord {
  id: number;
  seatCode: string;
  standId: number;
  standCode: string;
  standName: string;
  blockId: number;
  blockCode: string;
  blockName: string;
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  colorHex: string;
  seatPlasticHex?: string;
  isCovered: boolean;
  tier: number;
  rowNumber: number;
  seatNumber: number;
  instanceIndex: number;
  posX: number;
  posY: number;
  posZ: number;
  stepSurfaceY?: number;
  cushionSurfaceY?: number;
  backrestTopY?: number;
  eyePosY?: number;
  rotY: number;
  baseRotY?: number;
  yawJitterDeg?: number;
  heightJitterM?: number;
  wearFactor?: number;
  colorVariationSeed?: number;
  distanceToPitchM: number;
  distanceToBoundaryM: number;
  elevationAngleDeg: number;
  horizontalAngleDeg: number;
  scoreboardVisible: boolean;
  obstructionWarning: string;
  shadeAfternoonPct: number;
  viewQualityScore: number;
}

export interface SeatInventoryItem {
  seatId: number;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  holdUserId?: number | null;
  holdToken?: string | null;
  holdExpiresAt?: string | null;
}

export interface MatchSummary {
  id: number;
  stadiumId: number;
  tournament: string;
  title: string;
  startTime: string;
  status: string;
  demandMultiplier: number;
  rivalryMultiplier: number;
  weekendMultiplier: number;
  homeTeam?: {
    code: string;
    name: string;
    shortName: string;
    primaryColor: string;
    secondaryColor: string;
  };
  awayTeam?: {
    code: string;
    name: string;
    shortName: string;
    primaryColor: string;
    secondaryColor: string;
  };
  pricing: Array<{
    categoryId: number;
    categoryCode: string;
    categoryName: string;
    colorHex: string;
    basePricePaise: number;
    dynamicMultiplier: number;
    finalPricePaise: number;
    isCovered: boolean;
  }>;
  inventorySummary: {
    total: number;
    available: number;
    held: number;
    booked: number;
    blocked: number;
    occupancyPct: number;
  };
}

export interface ActiveHoldSession {
  holdToken: string;
  matchId: number;
  holdExpiresAt: string;
  totalAmountPaise: number;
  seats: Array<{
    seatId: number;
    seatCode: string;
    standName: string;
    blockName: string;
    categoryName: string;
    rowNumber: number;
    seatNumber: number;
    instanceIndex: number;
    pricePaise: number;
  }>;
}

export type CameraMode = 'ORBIT' | 'STAND_FOCUS' | 'SEAT_VIEW' | 'FREE_FLY' | 'TOUR';
export type QualityPreset = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';
export type RoofMode = 'SOLID' | 'XRAY' | 'HIDDEN';
export type SeatVisualMode = 'REALISTIC' | 'AVAILABILITY';
export type ActiveWorkspaceModal =
  | 'NONE'
  | 'SMART_FINDER'
  | 'CHECKOUT'
  | 'MY_TICKETS'
  | 'MY_QR'
  | 'BLENDER_CONTRACT';

interface StadiumState {
  // User & Auth
  currentUser: {
    id?: number;
    uid: string;
    email: string;
    name: string;
    role: 'USER';
  };
  sessionToken: string | null;

  // Stadium & Matches
  stadiumSpec: StadiumSpec | null;
  seats: StaticSeatRecord[];
  matches: MatchSummary[];
  activeMatchId: number;
  inventoryBySeatId: Record<number, SeatInventoryItem>;
  priceByCategoryId: Record<number, number>;
  inventoryVersion: number;
  lastSocketDelta: { nonce: number; seatIds: number[] } | null;

  // Selection, Inspection & Comparison
  hoveredSeat: StaticSeatRecord | null;
  focusedSeat: StaticSeatRecord | null;
  focusedSeatTelemetry: ViewTelemetryBreakdown | null;
  selectedSeatIds: number[];
  comparisonSeats: StaticSeatRecord[];
  activeHold: ActiveHoldSession | null;
  activeHotspot: StadiumHotspot | null;

  // Camera & 3D Environment (strictly decoupled from UI panel visibility)
  cameraMode: CameraMode;
  currentCameraMode: CameraMode;
  seatInstanceVisibility: boolean;
  activeStandCode: string | null;
  activeBlockCode: string | null;
  cameraResetNonce: number;
  seatExitNonce: number;
  preSeatViewState: {
    cameraMode: CameraMode;
    activeStandCode: string | null;
    activeBlockCode: string | null;
  } | null;
  freeFlySpeedMps: number;
  roofMode: RoofMode;
  seatVisualMode: SeatVisualMode;
  introPlaying: boolean;
  timeOfDayHours: number; // 8.0 to 22.0 (14.0 = Day, 17.75 = Dusk, 20.5 = Night)
  qualityPreset: QualityPreset;
  qualityPresetManual: boolean;
  is2DFallback: boolean;
  isHudCollapsed: boolean;
  isStadiumControlsOpen: boolean;
  isInspectorCollapsed: boolean;
  isSeatInspectorOpen: boolean;
  isLegendCollapsed: boolean;
  isSeatStatusOpen: boolean;
  isBowlRadarVisible: boolean;
  crowdAudioEnabled: boolean;
  seatViewFov: number;
  seatViewYawOffsetDeg: number;
  seatViewPitchOffsetDeg: number;

  // Filters
  filterCategoryCode: string; // 'ALL' or categoryCode
  filterMaxPricePaise: number; // 0 = no limit
  filterCoveredOnly: boolean;
  filterMinViewScore: number;

  // Modals & Notifications
  activeModal: ActiveWorkspaceModal;
  toastMessage: { text: string; type: 'info' | 'success' | 'warning' | 'error' } | null;

  // Actions
  setUserSession: (
    user: StadiumState['currentUser'],
    token: string | null
  ) => void;
  setStadiumData: (spec: StadiumSpec, seats: StaticSeatRecord[]) => void;
  setMatches: (matches: MatchSummary[]) => void;
  setActiveMatchId: (matchId: number) => void;
  setMatchInventory: (
    inventory: SeatInventoryItem[],
    pricing: Array<{ categoryId: number; finalPricePaise: number }>
  ) => void;
  applySocketSeatUpdate: (payload: {
    seatIds: number[];
    status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
    holdUserId?: number | null;
    holdExpiresAt?: string | null;
    holdToken?: string | null;
  }) => void;
  applySocketSeatBatch: (
    payloads: Array<{
      seatIds: number[];
      status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
      holdUserId?: number | null;
      holdExpiresAt?: string | null;
      holdToken?: string | null;
    }>
  ) => void;

  setHoveredSeat: (seat: StaticSeatRecord | null) => void;
  setFocusedSeat: (
    seat: StaticSeatRecord | null,
    telemetry?: ViewTelemetryBreakdown | null
  ) => void;
  toggleSeatSelection: (seatId: number) => void;
  setSelectedSeatIds: (seatIds: number[]) => void;
  clearSelectedSeats: () => void;
  toggleComparisonSeat: (seat: StaticSeatRecord) => void;
  setActiveHold: (hold: ActiveHoldSession | null) => void;
  setActiveHotspot: (hotspot: StadiumHotspot | null) => void;

  setCameraMode: (mode: CameraMode) => void;
  focusStand: (standCode: string | null, blockCode?: string | null) => void;
  resetCamera: () => void;
  setFreeFlySpeedMps: (speed: number) => void;
  setRoofMode: (mode: RoofMode) => void;
  setSeatVisualMode: (mode: SeatVisualMode) => void;
  setIntroPlaying: (playing: boolean) => void;
  enterSeatView: (seat: StaticSeatRecord, telemetry?: ViewTelemetryBreakdown | null) => void;
  exitSeatView: () => void;
  selectAndInspectSeat: (seat: StaticSeatRecord) => boolean;
  setSeatViewLook: (yawDeg: number, pitchDeg: number, fov?: number) => void;
  setTimeOfDayHours: (hours: number) => void;
  setQualityPreset: (preset: QualityPreset) => void;
  setIs2DFallback: (val: boolean) => void;
  setIsHudCollapsed: (val: boolean) => void;
  setIsStadiumControlsOpen: (val: boolean) => void;
  setIsInspectorCollapsed: (val: boolean) => void;
  setIsSeatInspectorOpen: (val: boolean) => void;
  setIsLegendCollapsed: (val: boolean) => void;
  setIsSeatStatusOpen: (val: boolean) => void;
  setIsBowlRadarVisible: (val: boolean) => void;
  setSeatInstanceVisibility: (val: boolean) => void;
  setCrowdAudioEnabled: (val: boolean) => void;

  setFilterCategoryCode: (code: string) => void;
  setFilterMaxPricePaise: (price: number) => void;
  setFilterCoveredOnly: (covered: boolean) => void;
  setFilterMinViewScore: (score: number) => void;

  setActiveModal: (modal: ActiveWorkspaceModal) => void;
  showToast: (
    text: string,
    type?: 'info' | 'success' | 'warning' | 'error'
  ) => void;
}

export const useStadiumStore = create<StadiumState>((set, get) => ({
  currentUser: {
    uid: 'demo-fan-uid',
    email: 'fan@stadiumx.in',
    name: 'Aarav Mehta',
    role: 'USER',
  },
  sessionToken: null,

  stadiumSpec: null,
  seats: [],
  matches: [],
  activeMatchId: 1,
  inventoryBySeatId: {},
  priceByCategoryId: {},
  inventoryVersion: 0,
  lastSocketDelta: null,

  hoveredSeat: null,
  focusedSeat: null,
  focusedSeatTelemetry: null,
  selectedSeatIds: [],
  comparisonSeats: [],
  activeHold: null,
  activeHotspot: null,

  cameraMode: 'ORBIT',
  currentCameraMode: 'ORBIT',
  seatInstanceVisibility: true,
  activeStandCode: null,
  activeBlockCode: null,
  cameraResetNonce: 0,
  seatExitNonce: 0,
  preSeatViewState: null,
  freeFlySpeedMps: 38,
  roofMode: 'SOLID',
  seatVisualMode: 'REALISTIC',
  introPlaying: true,
  timeOfDayHours: 15.5,
  qualityPreset: getInitialQualityPreset(),
  qualityPresetManual: false,
  is2DFallback: false,
  isHudCollapsed: true,
  isStadiumControlsOpen: false,
  isInspectorCollapsed: true,
  isSeatInspectorOpen: false,
  isLegendCollapsed: true,
  isSeatStatusOpen: false,
  isBowlRadarVisible: true,
  crowdAudioEnabled: false,
  seatViewFov: 64,
  seatViewYawOffsetDeg: 0,
  seatViewPitchOffsetDeg: 0,

  filterCategoryCode: 'ALL',
  filterMaxPricePaise: 0,
  filterCoveredOnly: false,
  filterMinViewScore: 0,

  activeModal: 'NONE',
  toastMessage: null,

  setUserSession: (user, token) => set({ currentUser: user, sessionToken: token }),
  setStadiumData: (spec, seats) => set({ stadiumSpec: spec, seats }),
  setMatches: (matches) => set({ matches }),
  setActiveMatchId: (matchId) =>
    set({
      activeMatchId: matchId,
      selectedSeatIds: [],
      focusedSeat: null,
      focusedSeatTelemetry: null,
    }),

  setMatchInventory: (inventory, pricing) => {
    const invMap: Record<number, SeatInventoryItem> = {};
    for (const item of inventory) {
      invMap[item.seatId] = item;
    }
    const priceMap: Record<number, number> = {};
    for (const p of pricing) {
      priceMap[p.categoryId] = p.finalPricePaise;
    }
    set((s) => ({
      inventoryBySeatId: invMap,
      priceByCategoryId: priceMap,
      inventoryVersion: s.inventoryVersion + 1,
    }));
  },

  applySocketSeatUpdate: (payload) => get().applySocketSeatBatch([payload]),

  applySocketSeatBatch: (payloads) => {
    if (payloads.length === 0) return;
    set((s) => {
      const nextInv = { ...s.inventoryBySeatId };
      const touchedSeatIds: number[] = [];
      let nextSelected = s.selectedSeatIds;
      let clearedHold = s.activeHold;

      for (const payload of payloads) {
        const { seatIds, status, holdUserId, holdExpiresAt, holdToken } = payload;
        for (const id of seatIds) {
          touchedSeatIds.push(id);
          nextInv[id] = {
            seatId: id,
            status,
            holdUserId: holdUserId ?? null,
            holdExpiresAt: holdExpiresAt ?? null,
            holdToken: holdToken ?? null,
          };
        }
        const isOurHold = s.activeHold && holdToken && s.activeHold.holdToken === holdToken;
        if (status !== 'AVAILABLE' && !isOurHold) {
          nextSelected = nextSelected.filter((id) => !seatIds.includes(id));
        }
        if (
          clearedHold &&
          status === 'AVAILABLE' &&
          clearedHold.seats.some((hs) => seatIds.includes(hs.seatId))
        ) {
          clearedHold = null;
        }
      }

      return {
        inventoryBySeatId: nextInv,
        selectedSeatIds: nextSelected,
        activeHold: clearedHold,
        lastSocketDelta: {
          nonce: (s.lastSocketDelta?.nonce ?? 0) + 1,
          seatIds: touchedSeatIds,
        },
      };
    });
  },

  setHoveredSeat: (seat) => set({ hoveredSeat: seat }),
  setFocusedSeat: (seat, telemetry = null) =>
    set({
      focusedSeat: seat,
      focusedSeatTelemetry: telemetry,
    }),

  toggleSeatSelection: (seatId) => {
    const state = get();
    const inv = state.inventoryBySeatId[seatId];
    if (inv && inv.status !== 'AVAILABLE') {
      if (inv.status === 'BOOKED') {
        state.showToast('This seat is already booked', 'warning');
      } else if (inv.status === 'BLOCKED') {
        state.showToast('This seat is unavailable', 'error');
      } else if (inv.status === 'HELD') {
        const isMine =
          (state.activeHold?.holdToken && inv.holdToken === state.activeHold.holdToken) ||
          (state.currentUser.id && inv.holdUserId === state.currentUser.id);
        if (isMine) {
          state.showToast('Reserved for you — continue checkout to confirm', 'info');
          if (state.activeHold) state.setActiveModal('CHECKOUT');
        } else {
          state.showToast('Temporarily reserved — try again shortly', 'warning');
        }
      }
      return;
    }
    const exists = state.selectedSeatIds.includes(seatId);
    if (exists) {
      set({ selectedSeatIds: state.selectedSeatIds.filter((id) => id !== seatId) });
    } else {
      if (state.selectedSeatIds.length >= 6) {
        state.showToast('Maximum 6 seats allowed per booking.', 'warning');
        return;
      }
      set({ selectedSeatIds: [...state.selectedSeatIds, seatId] });
    }
  },

  setSelectedSeatIds: (seatIds) => set({ selectedSeatIds: seatIds.slice(0, 6) }),
  clearSelectedSeats: () => set({ selectedSeatIds: [] }),

  toggleComparisonSeat: (seat) => {
    const current = get().comparisonSeats;
    const exists = current.some((s) => s.id === seat.id);
    if (exists) {
      set({ comparisonSeats: current.filter((s) => s.id !== seat.id) });
    } else {
      if (current.length >= 3) {
        get().showToast('Compare up to 3 seats side-by-side.', 'info');
        set({ comparisonSeats: [...current.slice(1), seat] });
      } else {
        set({ comparisonSeats: [...current, seat] });
      }
    }
  },

  setActiveHold: (hold) => set({ activeHold: hold }),
  setActiveHotspot: (hotspot) => set({ activeHotspot: hotspot }),

  setCameraMode: (mode) =>
    set({
      cameraMode: mode,
      currentCameraMode: mode,
      introPlaying: false,
      seatViewYawOffsetDeg: 0,
      seatViewPitchOffsetDeg: 0,
    }),

  focusStand: (standCode, blockCode = null) =>
    set((s) => {
      const nextMode: CameraMode = standCode ? 'STAND_FOCUS' : 'ORBIT';
      return {
        activeStandCode: standCode,
        activeBlockCode: blockCode,
        introPlaying: false,
        cameraMode: nextMode,
        currentCameraMode: nextMode,
        cameraResetNonce: standCode ? s.cameraResetNonce : s.cameraResetNonce + 1,
      };
    }),

  resetCamera: () =>
    set((s) => ({
      is2DFallback: false,
      introPlaying: false,
      cameraMode: 'ORBIT',
      currentCameraMode: 'ORBIT',
      activeStandCode: null,
      activeBlockCode: null,
      seatViewYawOffsetDeg: 0,
      seatViewPitchOffsetDeg: 0,
      cameraResetNonce: s.cameraResetNonce + 1,
    })),

  setFreeFlySpeedMps: (speed) =>
    set({
      freeFlySpeedMps: Math.max(8, Math.min(100, Math.round(speed))),
    }),

  setRoofMode: (mode) => set({ roofMode: mode }),
  setSeatVisualMode: (mode) => set({ seatVisualMode: mode }),
  setIntroPlaying: (playing) => set({ introPlaying: playing }),

  enterSeatView: (seat, telemetry = null) =>
    set((s) => ({
      focusedSeat: seat,
      focusedSeatTelemetry: telemetry,
      activeStandCode: seat.standCode,
      activeBlockCode: seat.blockCode,
      preSeatViewState:
        s.cameraMode !== 'SEAT_VIEW'
          ? {
              cameraMode: s.cameraMode,
              activeStandCode: s.activeStandCode,
              activeBlockCode: s.activeBlockCode,
            }
          : s.preSeatViewState,
      is2DFallback: false,
      introPlaying: false,
      cameraMode: 'SEAT_VIEW',
      currentCameraMode: 'SEAT_VIEW',
      seatViewYawOffsetDeg: 0,
      seatViewPitchOffsetDeg: 0,
      seatViewFov: 64,
    })),

  exitSeatView: () =>
    set((s) => {
      const prev = s.preSeatViewState;
      const returnMode: CameraMode =
        prev?.cameraMode === 'STAND_FOCUS' && prev.activeStandCode ? 'STAND_FOCUS' : 'ORBIT';
      return {
        cameraMode: returnMode,
        currentCameraMode: returnMode,
        activeStandCode: returnMode === 'STAND_FOCUS' ? prev?.activeStandCode ?? null : null,
        activeBlockCode: returnMode === 'STAND_FOCUS' ? prev?.activeBlockCode ?? null : null,
        seatViewYawOffsetDeg: 0,
        seatViewPitchOffsetDeg: 0,
        seatExitNonce: s.seatExitNonce + 1,
      };
    }),

  selectAndInspectSeat: (seat) => {
    const state = get();
    const inv = state.inventoryBySeatId[seat.id];
    const isAlreadySelected = state.selectedSeatIds.includes(seat.id);
    const availability = resolveSeatAvailabilityStatus({
      rawStatus: inv?.status || 'AVAILABLE',
      holdUserId: inv?.holdUserId,
      holdToken: inv?.holdToken,
      holdExpiresAt: inv?.holdExpiresAt,
      currentUserId: state.currentUser.id,
      activeHoldToken: state.activeHold?.holdToken,
      isSelected: isAlreadySelected,
    });

    if (availability.effectiveStatus === 'BOOKED') {
      state.setFocusedSeat(seat);
      state.showToast(`Seat ${seat.seatCode} is already booked`, 'warning');
      return false;
    }
    if (availability.effectiveStatus === 'BLOCKED') {
      state.setFocusedSeat(seat);
      state.showToast(`Seat ${seat.seatCode} is blocked / unavailable`, 'error');
      return false;
    }
    if (availability.effectiveStatus === 'HELD') {
      const mins = availability.remainingSec ? ` (${Math.ceil(availability.remainingSec / 60)}m left)` : '';
      state.setFocusedSeat(seat);
      state.showToast(`Seat ${seat.seatCode} is temporarily held by another fan${mins}`, 'warning');
      return false;
    }
    if (availability.effectiveStatus === 'HELD_BY_CURRENT_USER') {
      state.enterSeatView(seat);
      state.showToast(`Viewing your reserved seat ${seat.seatCode}`, 'info');
      return true;
    }

    // AVAILABLE / SELECTED
    if (isAlreadySelected && state.cameraMode !== 'SEAT_VIEW' && !state.is2DFallback) {
      set({
        selectedSeatIds: state.selectedSeatIds.filter((id) => id !== seat.id),
        focusedSeat: seat,
      });
      return false;
    }

    if (!isAlreadySelected) {
      if (state.selectedSeatIds.length >= 6) {
        state.showToast('Maximum 6 seats allowed per booking.', 'warning');
        return false;
      }
      set({ selectedSeatIds: [...state.selectedSeatIds, seat.id] });
    }

    state.enterSeatView(seat);
    return true;
  },

  setSeatViewLook: (yawDeg, pitchDeg, fov) =>
    set((s) => ({
      seatViewYawOffsetDeg: Math.max(-85, Math.min(85, yawDeg)),
      seatViewPitchOffsetDeg: Math.max(-35, Math.min(35, pitchDeg)),
      seatViewFov: fov !== undefined ? Math.max(28, Math.min(75, fov)) : s.seatViewFov,
    })),

  setTimeOfDayHours: (hours) => set({ timeOfDayHours: hours }),
  setQualityPreset: (preset) => {
    // Session-only manual graphics selection: never persist to localStorage so every fresh page load starts at LOW
    set({
      qualityPreset: preset,
      qualityPresetManual: true,
    });
  },
  setIs2DFallback: (val) => set({ is2DFallback: val }),
  setIsHudCollapsed: (val) => set({ isHudCollapsed: val, isStadiumControlsOpen: !val }),
  setIsStadiumControlsOpen: (val) => set({ isStadiumControlsOpen: val, isHudCollapsed: !val }),
  setIsInspectorCollapsed: (val) => set({ isInspectorCollapsed: val, isSeatInspectorOpen: !val }),
  setIsSeatInspectorOpen: (val) => set({ isSeatInspectorOpen: val, isInspectorCollapsed: !val }),
  setIsLegendCollapsed: (val) => set({ isLegendCollapsed: val, isSeatStatusOpen: !val }),
  setIsSeatStatusOpen: (val) => set({ isSeatStatusOpen: val, isLegendCollapsed: !val }),
  setIsBowlRadarVisible: (val) => set({ isBowlRadarVisible: val }),
  setSeatInstanceVisibility: (val) => set({ seatInstanceVisibility: val }),
  setCrowdAudioEnabled: (val) => set({ crowdAudioEnabled: val }),

  setFilterCategoryCode: (code) => set({ filterCategoryCode: code }),
  setFilterMaxPricePaise: (price) => set({ filterMaxPricePaise: price }),
  setFilterCoveredOnly: (covered) => set({ filterCoveredOnly: covered }),
  setFilterMinViewScore: (score) => set({ filterMinViewScore: score }),

  setActiveModal: (modal) => set({ activeModal: modal }),
  showToast: (text, type = 'info') => {
    set({ toastMessage: { text, type } });
    window.setTimeout(() => {
      if (get().toastMessage?.text === text) {
        set({ toastMessage: null });
      }
    }, 4000);
  },
}));
