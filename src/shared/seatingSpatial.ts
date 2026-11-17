import {
  DEFAULT_STADIUM_SPEC,
  SEAT_SUB_INSTANCES_PER_ANCHOR,
  computeContiguousSeatSubTransform,
  type GeneratedSeat,
  type StadiumSpec,
  type StandSpec,
} from './stadiumSpec';

export type SeatLodTier = 'LOD0' | 'LOD1' | 'LOD2' | 'LOD3';
export type SpatialQualityPreset = 'LOW' | 'MEDIUM' | 'HIGH' | 'ULTRA';

export interface QualityPresetConfig {
  preset: SpatialQualityPreset;
  maxDpr: number;
  maxDprSoftware: number;
  resolutionScale: number;
  shadowsEnabled: boolean;
  shadowMapSize: 512 | 1024 | 2048;
  seatsCastShadowLod1: boolean;
  seatsCastShadowLod2: boolean;
  seatsReceiveShadow: boolean;
  useSimpleSeatMaterial: boolean;
  useHeroLod0Pool: boolean;
  heroPoolMax: number;
  maxCrowd: number;
  crowdStride: number;
  maxAnisotropyCap: number;
  envMapIntensity: number;
  bloomEnabled: boolean;
  bloomHalfRes: boolean;
  aoEnabled: boolean;
  aoIntensity: number;
  macroDetailEnabled: boolean;
  fillLightEnabled: boolean;
  lod1SurfaceDist: number;
  lod2SurfaceDist: number;
}

export const QUALITY_PRESET_CONFIGS: Record<SpatialQualityPreset, QualityPresetConfig> = {
  LOW: {
    preset: 'LOW',
    maxDpr: 0.9,
    maxDprSoftware: 0.75,
    resolutionScale: 0.75,
    shadowsEnabled: false,
    shadowMapSize: 512,
    seatsCastShadowLod1: false,
    seatsCastShadowLod2: false,
    seatsReceiveShadow: false,
    useSimpleSeatMaterial: true,
    useHeroLod0Pool: false,
    heroPoolMax: 0,
    maxCrowd: 0,
    crowdStride: 999,
    maxAnisotropyCap: 1,
    envMapIntensity: 0.25,
    bloomEnabled: false,
    bloomHalfRes: true,
    aoEnabled: false,
    aoIntensity: 0,
    macroDetailEnabled: false,
    fillLightEnabled: false,
    lod1SurfaceDist: 0,
    lod2SurfaceDist: 18,
  },
  MEDIUM: {
    preset: 'MEDIUM',
    maxDpr: 1.15,
    maxDprSoftware: 0.9,
    resolutionScale: 0.9,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    seatsCastShadowLod1: false,
    seatsCastShadowLod2: false,
    seatsReceiveShadow: true,
    useSimpleSeatMaterial: false,
    useHeroLod0Pool: false,
    heroPoolMax: 0,
    maxCrowd: 900,
    crowdStride: 12,
    maxAnisotropyCap: 4,
    envMapIntensity: 0.85,
    bloomEnabled: false,
    bloomHalfRes: true,
    aoEnabled: true,
    aoIntensity: 0.45,
    macroDetailEnabled: true,
    fillLightEnabled: true,
    lod1SurfaceDist: 16,
    lod2SurfaceDist: 64,
  },
  HIGH: {
    preset: 'HIGH',
    maxDpr: 1.5,
    maxDprSoftware: 1.0,
    resolutionScale: 1.0,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    seatsCastShadowLod1: true,
    seatsCastShadowLod2: false,
    seatsReceiveShadow: true,
    useSimpleSeatMaterial: false,
    useHeroLod0Pool: true,
    heroPoolMax: 64,
    maxCrowd: 1800,
    crowdStride: 6,
    maxAnisotropyCap: 8,
    envMapIntensity: 1.05,
    bloomEnabled: true,
    bloomHalfRes: true,
    aoEnabled: true,
    aoIntensity: 0.75,
    macroDetailEnabled: true,
    fillLightEnabled: true,
    lod1SurfaceDist: 25,
    lod2SurfaceDist: 92,
  },
  ULTRA: {
    preset: 'ULTRA',
    maxDpr: 2.0,
    maxDprSoftware: 1.0,
    resolutionScale: 1.0,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    seatsCastShadowLod1: true,
    seatsCastShadowLod2: true,
    seatsReceiveShadow: true,
    useSimpleSeatMaterial: false,
    useHeroLod0Pool: true,
    heroPoolMax: 96,
    maxCrowd: 3200,
    crowdStride: 4,
    maxAnisotropyCap: 16,
    envMapIntensity: 1.15,
    bloomEnabled: true,
    bloomHalfRes: false,
    aoEnabled: true,
    aoIntensity: 0.92,
    macroDetailEnabled: true,
    fillLightEnabled: true,
    lod1SurfaceDist: 38,
    lod2SurfaceDist: 120,
  },
};

export function detectRecommendedQualityPreset(params: {
  isSoftwareGl: boolean;
  viewportWidth: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}): SpatialQualityPreset {
  const { isSoftwareGl, viewportWidth, hardwareConcurrency = 4, deviceMemory = 4 } = params;
  if (viewportWidth < 680 || hardwareConcurrency <= 2 || deviceMemory <= 2) {
    return 'LOW';
  }
  if (isSoftwareGl || viewportWidth < 1024 || hardwareConcurrency <= 4) {
    return 'MEDIUM';
  }
  if (hardwareConcurrency >= 8 && deviceMemory >= 8) {
    return 'HIGH';
  }
  return 'HIGH';
}

export interface SpatialSeatRef {
  anchorIdx: number;
  subIdx: number;
  localIdx: number;
  seatId: number;
  seatCode: string;
  anchorInstanceIndex: number;
  globalInstanceIndex: number;
  standCode: string;
  blockCode: string;
  categoryCode: string;
  categoryId: number;
  tier: number;
  rowNumber: number;
  seatNumber: number;
  isCovered: boolean;
  viewQualityScore: number;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  isCenterAnchor: boolean;
}

export interface BoundingSphereData {
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
}

export interface SeatSpatialChunk {
  chunkIndex: number;
  standCode: string;
  blockCode: string;
  tier: number;
  seats: SpatialSeatRef[];
  boundingSphere: BoundingSphereData;
}

export interface ChunkAnchorSlot {
  chunkIndex: number;
  localStartIdx: number;
}

export interface SpatialSeatingIndex {
  chunks: SeatSpatialChunk[];
  anchorSlotByInstanceIndex: ChunkAnchorSlot[];
  totalSubInstances: number;
}

export interface InputStaticSeat {
  id: number;
  seatCode: string;
  standCode: string;
  blockCode: string;
  categoryCode: string;
  categoryId: number;
  tier: number;
  rowNumber: number;
  seatNumber: number;
  instanceIndex: number;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  baseRotY?: number;
  isCovered: boolean;
  viewQualityScore: number;
}

/**
 * Partitions all 4,800 DB seat anchors (× 7 contiguous 0.48 m sub-seats = 33,600 3D seats)
 * into 24 frustum-cullable spatial chunks (8 stands × 3 tiers) with tight bounding spheres.
 */
export function buildSpatialSeatingIndex(
  seats: InputStaticSeat[],
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): SpatialSeatingIndex {
  const chunkMap = new Map<string, SeatSpatialChunk>();
  const anchorSlotByInstanceIndex: ChunkAnchorSlot[] = new Array(seats.length);

  for (let i = 0; i < seats.length; i++) {
    const s = seats[i];
    const key = `${s.standCode}:${s.blockCode}`;
    let chunk = chunkMap.get(key);
    if (!chunk) {
      chunk = {
        chunkIndex: chunkMap.size,
        standCode: s.standCode,
        blockCode: s.blockCode,
        tier: s.tier,
        seats: [],
        boundingSphere: { centerX: 0, centerY: 0, centerZ: 0, radius: 1 },
      };
      chunkMap.set(key, chunk);
    }

    const localStartIdx = chunk.seats.length;
    anchorSlotByInstanceIndex[s.instanceIndex] = {
      chunkIndex: chunk.chunkIndex,
      localStartIdx,
    };

    for (let subIdx = 0; subIdx < SEAT_SUB_INSTANCES_PER_ANCHOR; subIdx++) {
      const sub = computeContiguousSeatSubTransform(
        s as Pick<GeneratedSeat, 'tier' | 'rowNumber' | 'posX' | 'posY' | 'posZ' | 'rotY'> & {
          baseRotY?: number;
        },
        subIdx,
        spec
      );

      chunk.seats.push({
        anchorIdx: i,
        subIdx,
        localIdx: chunk.seats.length,
        seatId: s.id,
        seatCode: s.seatCode,
        anchorInstanceIndex: s.instanceIndex,
        globalInstanceIndex: s.instanceIndex * SEAT_SUB_INSTANCES_PER_ANCHOR + subIdx,
        standCode: s.standCode,
        blockCode: s.blockCode,
        categoryCode: s.categoryCode,
        categoryId: s.categoryId,
        tier: s.tier,
        rowNumber: s.rowNumber,
        seatNumber: s.seatNumber,
        isCovered: s.isCovered,
        viewQualityScore: s.viewQualityScore,
        posX: sub.posX,
        posY: sub.posY,
        posZ: sub.posZ,
        rotY: sub.rotY,
        isCenterAnchor: sub.subOffset === 0,
      });
    }
  }

  const chunks = Array.from(chunkMap.values());
  let totalSubInstances = 0;

  for (const chunk of chunks) {
    totalSubInstances += chunk.seats.length;
    if (chunk.seats.length === 0) continue;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const seat of chunk.seats) {
      if (seat.posX < minX) minX = seat.posX;
      if (seat.posY < minY) minY = seat.posY;
      if (seat.posZ < minZ) minZ = seat.posZ;
      if (seat.posX > maxX) maxX = seat.posX;
      if (seat.posY > maxY) maxY = seat.posY;
      if (seat.posZ > maxZ) maxZ = seat.posZ;
    }

    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5 + 0.45;
    const cz = (minZ + maxZ) * 0.5;

    let maxSq = 0;
    for (const seat of chunk.seats) {
      const dx = seat.posX - cx;
      const dy = seat.posY + 0.45 - cy;
      const dz = seat.posZ - cz;
      const sq = dx * dx + dy * dy + dz * dz;
      if (sq > maxSq) maxSq = sq;
    }

    chunk.boundingSphere = {
      centerX: Number(cx.toFixed(4)),
      centerY: Number(cy.toFixed(4)),
      centerZ: Number(cz.toFixed(4)),
      radius: Number((Math.sqrt(maxSq) + 0.9).toFixed(4)),
    };
  }

  return {
    chunks,
    anchorSlotByInstanceIndex,
    totalSubInstances,
  };
}

/**
 * Selects appropriate geometry LOD for a spatial chunk based on camera distance to chunk sphere.
 */
export function selectChunkLod(
  camX: number,
  camY: number,
  camZ: number,
  sphere: BoundingSphereData,
  qualityPreset: SpatialQualityPreset,
  isSoftwareGl: boolean
): SeatLodTier {
  const distToCenter = Math.hypot(
    camX - sphere.centerX,
    camY - sphere.centerY,
    camZ - sphere.centerZ
  );
  const surfaceDist = Math.max(0, distToCenter - sphere.radius);

  if (isSoftwareGl) {
    if (qualityPreset === 'LOW') {
      return 'LOD3';
    }
    if ((qualityPreset === 'HIGH' || qualityPreset === 'ULTRA') && surfaceDist < 7.0) {
      return 'LOD1';
    }
    return surfaceDist < 28 ? 'LOD2' : 'LOD3';
  }

  const cfg = QUALITY_PRESET_CONFIGS[qualityPreset];
  if (cfg.lod1SurfaceDist > 0 && surfaceDist < cfg.lod1SurfaceDist) return 'LOD1';
  if (surfaceDist < cfg.lod2SurfaceDist) return 'LOD2';
  return 'LOD3';
}

export type EffectiveSeatStatus =
  | 'AVAILABLE'
  | 'BOOKED'
  | 'HELD'
  | 'SELECTED'
  | 'BLOCKED'
  | 'HELD_BY_CURRENT_USER';

export interface SeatAvailabilityDescriptor {
  effectiveStatus: EffectiveSeatStatus;
  /** Numeric GPU shader code: 0=AVAILABLE, 1=BOOKED, 2=HELD_OTHER, 3=SELECTED, 4=BLOCKED, 5=HELD_SELF */
  shaderStateCode: 0 | 1 | 2 | 3 | 4 | 5;
  symbol: string;
  label: string;
  remainingSec: number | null;
}

export function resolveSeatAvailabilityStatus(params: {
  rawStatus?: string | null;
  holdUserId?: number | null;
  holdToken?: string | null;
  holdExpiresAt?: string | null;
  currentUserId?: number | null;
  activeHoldToken?: string | null;
  isSelected: boolean;
  nowMs?: number;
}): SeatAvailabilityDescriptor {
  const {
    rawStatus = 'AVAILABLE',
    holdUserId,
    holdToken,
    holdExpiresAt,
    currentUserId,
    activeHoldToken,
    isSelected,
    nowMs = Date.now(),
  } = params;

  const remainingSec =
    holdExpiresAt && rawStatus === 'HELD'
      ? Math.max(0, Math.ceil((new Date(holdExpiresAt).getTime() - nowMs) / 1000))
      : null;

  if (rawStatus === 'BOOKED') {
    return {
      effectiveStatus: 'BOOKED',
      shaderStateCode: 1,
      symbol: '✕',
      label: 'Booked',
      remainingSec: null,
    };
  }
  if (rawStatus === 'BLOCKED') {
    return {
      effectiveStatus: 'BLOCKED',
      shaderStateCode: 4,
      symbol: '⊘',
      label: 'Blocked',
      remainingSec: null,
    };
  }
  if (rawStatus === 'HELD') {
    const isMine =
      (activeHoldToken && holdToken && activeHoldToken === holdToken) ||
      (currentUserId && holdUserId && currentUserId === holdUserId);
    if (isMine) {
      return {
        effectiveStatus: 'HELD_BY_CURRENT_USER',
        shaderStateCode: 5,
        symbol: '★',
        label: 'Reserved for You',
        remainingSec,
      };
    }
    return {
      effectiveStatus: 'HELD',
      shaderStateCode: 2,
      symbol: '⏱',
      label: 'Temporarily Held',
      remainingSec,
    };
  }
  if (isSelected) {
    return {
      effectiveStatus: 'SELECTED',
      shaderStateCode: 3,
      symbol: '✓',
      label: 'Selected',
      remainingSec: null,
    };
  }
  return {
    effectiveStatus: 'AVAILABLE',
    shaderStateCode: 0,
    symbol: '●',
    label: 'Available',
    remainingSec: null,
  };
}

/**
 * Computes seat color factor and selection scale consistently without reallocating objects.
 */
export function computeSeatVisualHex(params: {
  seat: Pick<SpatialSeatRef, 'categoryCode' | 'tier' | 'rowNumber' | 'seatNumber' | 'subIdx' | 'isCenterAnchor' | 'globalInstanceIndex'>;
  status: string;
  isHovered: boolean;
  isSelected: boolean;
  isFocused: boolean;
  matchesFilter: boolean;
}): { hex: string; scale: number; brightnessMultiplier: number } {
  const { seat, status, isHovered, isSelected, isFocused, matchesFilter } = params;

  if (isHovered) {
    return {
      hex: seat.isCenterAnchor ? '#FFFFFF' : '#BAE6FD',
      scale: seat.isCenterAnchor ? 1.16 : 1.06,
      brightnessMultiplier: 1.0,
    };
  }
  if (isFocused && !isSelected && status === 'AVAILABLE') {
    return {
      hex: seat.isCenterAnchor ? '#FACC15' : '#FDE047',
      scale: seat.isCenterAnchor ? 1.16 : 1.05,
      brightnessMultiplier: 1.0,
    };
  }

  const categorySeatPlasticMap: Record<string, string> = {
    LOWER_BOWL: '#1D4ED8',
    PAVILION_CLUB: '#0284C7',
    VIP_LOUNGE: '#1E3A8A',
    HOSPITALITY_BOX: '#2563EB',
    UPPER_TIER: '#1D4ED8',
  };

  // Cohesive architectural stadium color blocking: saffron/amber pavilion waves, crisp sky-blue stripes & white row markers
  const isVipAccentRow = seat.tier === 2 && (seat.rowNumber === 1 || seat.rowNumber === 10);
  const isLowerAccentStripe = seat.tier === 1 && (seat.rowNumber === 5 || seat.rowNumber === 6);
  const isUpperWaveBand =
    seat.tier === 3 &&
    ((seat.rowNumber >= 4 && seat.rowNumber <= 7) ||
      (seat.rowNumber >= 8 && (seat.seatNumber + seat.subIdx) % 4 === 0));

  let hex = categorySeatPlasticMap[seat.categoryCode] || '#1D4ED8';
  if (isUpperWaveBand) {
    hex = seat.rowNumber % 2 === 0 ? '#F97316' : '#F59E0B';
  } else if (isLowerAccentStripe) {
    hex = '#38BDF8';
  } else if (isVipAccentRow) {
    hex = '#E2E8F0';
  }

  const microLift =
    0.95 + ((seat.globalInstanceIndex * 31 + seat.rowNumber * 7) % 11) * 0.008;
  const dimFactor = matchesFilter ? 1.0 : 0.56;
  const statusScale =
    isSelected && seat.isCenterAnchor ? 1.12 : isSelected ? 1.05 : 1.0;
  const statusDim =
    status === 'BOOKED' ? 0.82 : status === 'BLOCKED' ? 0.72 : 1.0;

  return {
    hex,
    scale: statusScale,
    brightnessMultiplier: Number((microLift * dimFactor * statusDim).toFixed(4)),
  };
}

/**
 * Computes panoramic stand-focus camera position and look-at target that keeps all 3 tiers
 * well-framed in viewport without clipping behind outer bowl walls.
 */
export function computeStandFocusCamera(
  standSpec: Pick<StandSpec, 'orientationAngleDeg'>,
  blockCode: string | null
): {
  position: [number, number, number];
  target: [number, number, number];
} {
  const angleRad = (standSpec.orientationAngleDeg * Math.PI) / 180;
  const isT1 = Boolean(blockCode?.endsWith('T1'));
  const isT2 = Boolean(blockCode?.endsWith('T2'));
  const isT3 = Boolean(blockCode?.endsWith('T3'));

  const targetRadiusM = isT1 ? 80 : isT2 ? 89 : isT3 ? 98 : 88;
  const targetY = isT1 ? 3.8 : isT2 ? 9.8 : isT3 ? 16.8 : 10.2;
  const camRadiusM = isT1 ? 36 : isT2 ? 34 : isT3 ? 30 : 20;
  const camY = isT1 ? 14 : isT2 ? 20 : isT3 ? 26 : 24;

  const sinA = Math.sin(angleRad);
  const cosA = Math.cos(angleRad);

  return {
    position: [
      Number((sinA * camRadiusM).toFixed(3)),
      camY,
      Number((-cosA * camRadiusM).toFixed(3)),
    ],
    target: [
      Number((sinA * targetRadiusM).toFixed(3)),
      targetY,
      Number((-cosA * targetRadiusM).toFixed(3)),
    ],
  };
}

/**
 * Computes exact seated first-person eye camera transform (+1.15m above concrete step)
 * aimed toward the center 22-yard cricket pitch (0, 0.8, 0) plus user head-look offsets.
 */
export function computeSeatViewCamera(
  seat: Pick<InputStaticSeat, 'posX' | 'posY' | 'posZ'>,
  yawOffsetDeg = 0,
  pitchOffsetDeg = 0
): {
  position: [number, number, number];
  lookAt: [number, number, number];
  basePitchDeg: number;
} {
  const eyeY = seat.posY + 1.15;
  const groundDist = Math.max(10, Math.hypot(seat.posX, seat.posZ));
  const baseYawRad = Math.atan2(-seat.posX, -seat.posZ);
  const basePitchRad = Math.atan2(0.8 - eyeY, groundDist);
  const basePitchDeg = (basePitchRad * 180) / Math.PI;

  const yawRad = baseYawRad + (yawOffsetDeg * Math.PI) / 180;
  const clampedPitchDeg = Math.max(-45, Math.min(35, basePitchDeg + pitchOffsetDeg));
  const pitchRad = (clampedPitchDeg * Math.PI) / 180;

  const lookDist = 80;
  return {
    position: [seat.posX, Number(eyeY.toFixed(4)), seat.posZ],
    lookAt: [
      Number((seat.posX + Math.sin(yawRad) * Math.cos(pitchRad) * lookDist).toFixed(4)),
      Number((eyeY + Math.sin(pitchRad) * lookDist).toFixed(4)),
      Number((seat.posZ + Math.cos(yawRad) * Math.cos(pitchRad) * lookDist).toFixed(4)),
    ],
    basePitchDeg: Number(basePitchDeg.toFixed(2)),
  };
}

/**
 * Computes signed radial offset in metres outward from the base bowl ellipse
 * (semiMajorAxisX=84, semiMinorAxisZ=72) using 2 fast Newton iterations.
 * Negative values are inside the outfield/pitch; positive values climb the 3 bowl tiers.
 */
export function computeBowlRadialOffsetM(
  x: number,
  z: number,
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): number {
  const a = spec.semiMajorAxisX;
  const b = spec.semiMinorAxisZ;
  const norm = Math.hypot(x / a, z / b);
  if (norm < 1e-6) return -Math.min(a, b);

  let d = (norm - 1) * (a + b) * 0.5;
  d = Math.max(-Math.min(a, b) + 1.0, d);
  const x2 = x * x;
  const z2 = z * z;
  for (let i = 0; i < 2; i++) {
    const ad = Math.max(1.0, a + d);
    const bd = Math.max(1.0, b + d);
    const f = x2 / (ad * ad) + z2 / (bd * bd) - 1;
    const fp = -2 * (x2 / (ad * ad * ad) + z2 / (bd * bd * bd));
    if (Math.abs(fp) > 1e-6) {
      d -= f / fp;
    }
  }
  return d;
}

/**
 * Estimates stadium floor / stepped seating / outer ground elevation in metres at (x, z)
 * matching DEFAULT_STADIUM_SPEC tiers cleanly for real-time camera collision & cursor zoom.
 */
export function estimateStadiumSurfaceY(
  x: number,
  z: number,
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): number {
  const d = computeBowlRadialOffsetM(x, z, spec);
  if (d < 2.2) {
    // Outfield turf & pitch area
    return 0.05;
  }
  if (d < 4.0) {
    // Inner boundary perimeter walkway & front T1 wall
    return 0.35 + ((d - 2.2) / 1.8) * 1.85;
  }
  if (d <= 11.2) {
    // Tier 1 steps (2.2m to 4.9m)
    return 2.2 + ((d - 4.0) / 7.2) * 2.7;
  }
  if (d < 13.6) {
    // Concourse & T1->T2 riser wall
    return 4.9 + ((d - 11.2) / 2.4) * 3.3;
  }
  if (d <= 20.8) {
    // Tier 2 steps (8.2m to 11.44m)
    return 8.2 + ((d - 13.6) / 7.2) * 3.24;
  }
  if (d < 23.2) {
    // Concourse & T2->T3 riser wall
    return 11.44 + ((d - 20.8) / 2.4) * 3.76;
  }
  if (d <= 30.8) {
    // Tier 3 upper bowl steps (15.2m to 19.2m)
    return 15.2 + ((d - 23.2) / 7.6) * 4.0;
  }
  if (d <= 35.5) {
    // Top bowl ring wall / outer concourse top
    return 19.2;
  }
  if (d <= 43.0) {
    // Exterior concourse steps descending to stadium plaza
    return Math.max(0.0, 19.2 * (1 - (d - 35.5) / 7.5));
  }
  return 0.0;
}

/**
 * Clamps any 3D camera coordinate so it never punches beneath the turf/tiers/steps,
 * never stays trapped inside the PTFE roof canopy slab (27.4m..32.6m over the roof annulus),
 * and remains inside arena spatial bounds.
 */
export function clampStadiumCameraPosition(
  x: number,
  y: number,
  z: number,
  prevY?: number,
  targetYHint?: number,
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): [number, number, number] {
  const maxR = 235;
  const rHoriz = Math.hypot(x, z);
  let cx = x;
  let cz = z;
  if (rHoriz > maxR && rHoriz > 1e-4) {
    const scale = maxR / rHoriz;
    cx *= scale;
    cz *= scale;
  }

  const floorY = estimateStadiumSurfaceY(cx, cz, spec);
  const minClearY = floorY + 1.45;
  let cy = Math.max(minClearY, Math.min(165, y));

  // Prevent camera from getting trapped inside the cantilevered PTFE roof canopy slab
  const inRoofInner = Math.hypot(cx / spec.roofInnerRadiusX, cz / spec.roofInnerRadiusZ);
  const inRoofOuter = Math.hypot(cx / spec.roofOuterRadiusX, cz / spec.roofOuterRadiusZ);
  if (inRoofInner >= 0.97 && inRoofOuter <= 1.03) {
    const roofSlabBottom = spec.roofHeightM - 2.3; // 27.2m
    const roofSlabTop = spec.roofHeightM + 3.1; // 32.6m
    if (cy > roofSlabBottom && cy < roofSlabTop) {
      // Allow diving under canopy cleanly when zooming toward a lower target or flying from below
      const preferBelow =
        (targetYHint !== undefined && targetYHint < 25.0) ||
        (prevY !== undefined && prevY < spec.roofHeightM);
      cy = preferBelow
        ? Math.max(minClearY, roofSlabBottom)
        : roofSlabTop;
    }
  }

  return [cx, cy, cz];
}

/**
 * Fast analytic ray-surface intersection against the stadium bowl & pitch heightfield.
 * Used for smooth cursor-ray zoom in <0.02 ms without per-wheel-tick mesh raycasting.
 */
export function intersectStadiumCursorRay(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  fallbackDistanceM = 85,
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): { x: number; y: number; z: number; distance: number; hitSurface: boolean } {
  const maxT = 340;
  let t = 1.5;
  let hitT = -1;

  for (let i = 0; i < 96 && t <= maxT; i++) {
    const px = ox + dx * t;
    const pz = oz + dz * t;
    const py = oy + dy * t;
    const surfY = estimateStadiumSurfaceY(px, pz, spec);
    const diff = py - surfY;

    if (diff <= 0.15) {
      // Bisect cleanly between previous t and current t
      let lo = Math.max(0.5, t - Math.max(1.2, Math.abs(diff) * 0.6 + 2.2));
      let hi = t;
      for (let b = 0; b < 7; b++) {
        const mid = (lo + hi) * 0.5;
        const mDiff =
          oy + dy * mid - estimateStadiumSurfaceY(ox + dx * mid, oz + dz * mid, spec);
        if (mDiff > 0) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      hitT = (lo + hi) * 0.5;
      break;
    }

    const step = Math.max(1.2, Math.min(4.8, diff * 0.42));
    t += step;
  }

  if (hitT > 0) {
    const hx = ox + dx * hitT;
    const hz = oz + dz * hitT;
    const hy = Math.max(0.05, estimateStadiumSurfaceY(hx, hz, spec));
    return { x: hx, y: hy, z: hz, distance: hitT, hitSurface: true };
  }

  const dist = Math.max(12, Math.min(180, fallbackDistanceM));
  return {
    x: THREE_CLAMP(ox + dx * dist, -140, 140),
    y: THREE_CLAMP(oy + dy * dist, 1.5, 48),
    z: THREE_CLAMP(oz + dz * dist, -140, 140),
    distance: dist,
    hitSurface: false,
  };
}

function THREE_CLAMP(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
