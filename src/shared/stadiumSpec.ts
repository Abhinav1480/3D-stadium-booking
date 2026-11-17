export interface SeatCategorySpec {
  code: 'VIP_LOUNGE' | 'HOSPITALITY_BOX' | 'PAVILION_CLUB' | 'LOWER_BOWL' | 'UPPER_TIER';
  name: string;
  colorHex: string;
  seatPlasticHex: string;
  basePricePaise: number;
  isCovered: boolean;
  tierLevel: number;
  description: string;
}

export interface SeatingDimensionsSpec {
  /** Seat width / lateral pitch in metres (default 0.48 m, configurable 0.46 to 0.52 m) */
  seatWidthM: number;
  seatWidthMinM: number;
  seatWidthMaxM: number;
  /** Row depth / horizontal tread going in metres (default 0.80 m, configurable 0.75 to 0.85 m) */
  rowDepthM: number;
  rowDepthMinM: number;
  rowDepthMaxM: number;
  /** Step riser height per tier in metres: lower 0.30 m, middle 0.36 m, upper 0.42 m */
  riserHeightByTierM: {
    1: number;
    2: number;
    3: number;
  };
  /** Seat cushion top height above concrete step surface (0.42 m) */
  seatCushionHeightM: number;
  /** Seat backrest top height above concrete step surface (0.85 m) */
  seatBackrestTopHeightM: number;
  /** Seated first-person camera eye height above concrete step surface (1.15 m) */
  seatedEyeHeightAboveStepM: number;
  /** Radial aisle clear width between seat sub-blocks (1.20 m) */
  aisleWidthM: number;
  /** Individual aisle stair tread depth (0.28 m) */
  stairTreadDepthM: number;
  /** Tubular steel handrail height above stair/step (1.00 m) */
  handrailHeightM: number;
  /** Front tier parapet wall height above front walkway (1.10 m) */
  parapetWallHeightM: number;
  /** Deterministic per-seat random yaw jitter limit in degrees (±0.5°) */
  maxYawJitterDeg: number;
  /** Deterministic per-seat vertical micro-variation in metres (±0.0035 m) */
  maxHeightJitterM: number;
}

export interface BlockSpec {
  code: string;
  name: string;
  tier: 1 | 2 | 3;
  categoryCode: SeatCategorySpec['code'];
  rowCount: number;
  seatsPerRow: number;
  elevationBaseM: number;
  riserHeightM: number;
  rowDepthM: number;
  seatWidthM: number;
  rakeAngleDeg: number;
  radialOffsetM: number;
}

export interface StandSpec {
  code:
    | 'NORTH'
    | 'NORTH_EAST'
    | 'EAST'
    | 'SOUTH_EAST'
    | 'SOUTH'
    | 'SOUTH_WEST'
    | 'WEST'
    | 'NORTH_WEST';
  name: string;
  shortName: string;
  orientationAngleDeg: number;
  arcSpanDeg: number;
  blocks: BlockSpec[];
}

export interface StadiumHotspot {
  id: string;
  label: string;
  category: 'PAVILION' | 'LOUNGE' | 'FOOD_COURT' | 'GATE' | 'MEDICAL' | 'SCOREBOARD' | 'PARKING';
  description: string;
  position: [number, number, number];
}

export interface StadiumSpec {
  code: string;
  name: string;
  city: string;
  country: string;
  semiMajorAxisX: number;
  semiMinorAxisZ: number;
  boundaryRatio: number;
  roofInnerRadiusX: number;
  roofInnerRadiusZ: number;
  roofOuterRadiusX: number;
  roofOuterRadiusZ: number;
  roofHeightM: number;
  /** Alias kept for backward compatibility; equals dimensions.rowDepthM (0.80 m) */
  rowSpacingM: number;
  /** Alias kept for backward compatibility; equals dimensions.seatWidthM (0.48 m) */
  seatSpacingM: number;
  dimensions: SeatingDimensionsSpec;
  scoreboardAnglesDeg: number[];
  pillarAnglesDeg: number[];
  categories: SeatCategorySpec[];
  stands: StandSpec[];
  hotspots: StadiumHotspot[];
}

export interface GeneratedSeat {
  seatCode: string;
  standCode: StandSpec['code'];
  standName: string;
  blockCode: string;
  blockName: string;
  categoryCode: SeatCategorySpec['code'];
  tier: number;
  rowNumber: number;
  seatNumber: number;
  instanceIndex: number;
  /** World X coordinate in metres (1 unit = 1 m) */
  posX: number;
  /** World Y coordinate at the seat mounting step surface including deterministic micro-jitter */
  posY: number;
  /** World Z coordinate in metres (1 unit = 1 m) */
  posZ: number;
  /** Exact concrete step surface elevation in metres before seat micro-jitter */
  stepSurfaceY: number;
  /** Cushion top elevation in metres (posY + 0.42 m) */
  cushionSurfaceY: number;
  /** Backrest top elevation in metres (posY + 0.85 m) */
  backrestTopY: number;
  /** Seated eye elevation in metres (posY + 1.15 m) */
  eyePosY: number;
  /** World yaw rotation in radians facing pitch centre + deterministic ±0.5° jitter */
  rotY: number;
  /** Exact base yaw in radians toward (0,0,0) before jitter */
  baseRotY: number;
  /** Deterministic yaw jitter in degrees within [-0.5°, +0.5°] */
  yawJitterDeg: number;
  /** Deterministic height micro-variation in metres within [-0.0035, +0.0035] */
  heightJitterM: number;
  /** Deterministic wear attribute [0.05 .. 0.35] for PBR dirt/scuff shader */
  wearFactor: number;
  /** Deterministic shade/albedo variation seed [0.0 .. 1.0] */
  colorVariationSeed: number;
  distanceToPitchM: number;
  distanceToBoundaryM: number;
  elevationAngleDeg: number;
  horizontalAngleDeg: number;
  scoreboardVisible: boolean;
  obstructionWarning: string;
  shadeAfternoonPct: number;
  viewQualityScore: number;
}

export interface BowlRowCurveMetadata {
  standCode: StandSpec['code'];
  blockCode: string;
  tier: 1 | 2 | 3;
  rowNumber: number;
  stepElevationY: number;
  riserHeightM: number;
  rowDepthM: number;
  ellipseRadiusX: number;
  ellipseRadiusZ: number;
  startAngleRad: number;
  endAngleRad: number;
  aisleAnglesRad: [number, number];
}

export interface ViewTelemetryBreakdown {
  seatCode: string;
  distanceToPitchM: number;
  distanceToBoundaryM: number;
  elevationAngleDeg: number;
  horizontalAngleDeg: number;
  sightlineCategory: 'Straight-On Bowler/Batter Arm' | 'Diagonal Mid-Wicket / Cover' | 'Square Point / Square Leg';
  scoreboardVisible: boolean;
  nearestScoreboardAngleDiffDeg: number;
  obstructionWarning: string;
  shadePctAtTime: number;
  sunElevationDeg: number;
  sunAzimuthDeg: number;
  viewQualityScore: number;
  summaryExplanation: string;
  eyePosition: [number, number, number];
  lookAtTarget: [number, number, number];
}

export type RecommendationSortBy =
  | 'MATCH_SCORE'
  | 'PRICE_ASC'
  | 'VIEW_SCORE'
  | 'CLOSEST_PITCH'
  | 'SHADE';

export interface RecommendationPreferences {
  budgetPerSeatPaise: number;
  groupSize: number;
  preferredCategoryCode?: string;
  preferredStandCode?: string;
  preferBestView?: boolean;
  preferShade: boolean;
  preferStraightView: boolean;
  preferCloseToPitch: boolean;
  preferBestElevation?: boolean;
  preferNearEntrance?: boolean;
  preferFamilyZone: boolean;
  requireAdjacentSeats?: boolean;
  sortBy?: RecommendationSortBy;
}

export interface SeatRecommendationGroup {
  groupId: string;
  standCode: string;
  standName: string;
  blockCode: string;
  blockName: string;
  tier: number;
  categoryName: string;
  categoryCode: string;
  rowNumber: number;
  seatNumbers: number[];
  seatCodes: string[];
  seatIds: number[];
  instanceIndices: number[];
  totalPricePaise: number;
  pricePerSeatPaise: number;
  averageViewScore: number;
  averageShadePct: number;
  distanceToPitchM: number;
  elevationAngleDeg: number;
  horizontalAngleDeg: number;
  scoreboardVisible: boolean;
  seatsTogether: boolean;
  availableInBlockCount: number;
  reasons: string[];
  matchScore: number;
  explanation: string;
}

/**
 * Exact Section A Real-World Stadium Seating Dimensions (1 unit = 1.00 metre)
 */
export const DEFAULT_SEATING_DIMENSIONS: SeatingDimensionsSpec = {
  seatWidthM: 0.48,
  seatWidthMinM: 0.46,
  seatWidthMaxM: 0.52,
  rowDepthM: 0.80,
  rowDepthMinM: 0.75,
  rowDepthMaxM: 0.85,
  riserHeightByTierM: {
    1: 0.30, // Lower tier riser: 0.30 m (rake = atan(0.30/0.80) = 20.56°)
    2: 0.36, // Middle tier riser: 0.36 m (rake = atan(0.36/0.80) = 24.23°)
    3: 0.42, // Upper tier riser: 0.42 m (rake = atan(0.42/0.80) = 27.70°)
  },
  seatCushionHeightM: 0.42,
  seatBackrestTopHeightM: 0.85,
  seatedEyeHeightAboveStepM: 1.15,
  aisleWidthM: 1.20,
  stairTreadDepthM: 0.28,
  handrailHeightM: 1.00,
  parapetWallHeightM: 1.10,
  maxYawJitterDeg: 0.5,
  maxHeightJitterM: 0.0035,
};

function computeRakeDeg(riserM: number, goingM: number): number {
  return Number(((Math.atan2(riserM, goingM) * 180) / Math.PI).toFixed(2));
}

function createStandBlocks(
  prefix: string,
  names: [string, string, string],
  categories: [SeatCategorySpec['code'], SeatCategorySpec['code'], SeatCategorySpec['code']]
): BlockSpec[] {
  const d = DEFAULT_SEATING_DIMENSIONS;
  return [
    {
      code: `${prefix}-T1`,
      name: names[0],
      tier: 1,
      categoryCode: categories[0],
      rowCount: 10,
      seatsPerRow: 20,
      elevationBaseM: 2.2,
      riserHeightM: d.riserHeightByTierM[1],
      rowDepthM: d.rowDepthM,
      seatWidthM: d.seatWidthM,
      rakeAngleDeg: computeRakeDeg(d.riserHeightByTierM[1], d.rowDepthM),
      radialOffsetM: 4.0,
    },
    {
      code: `${prefix}-T2`,
      name: names[1],
      tier: 2,
      categoryCode: categories[1],
      rowCount: 10,
      seatsPerRow: 20,
      elevationBaseM: 8.2,
      riserHeightM: d.riserHeightByTierM[2],
      rowDepthM: d.rowDepthM,
      seatWidthM: d.seatWidthM,
      rakeAngleDeg: computeRakeDeg(d.riserHeightByTierM[2], d.rowDepthM),
      radialOffsetM: 13.6,
    },
    {
      code: `${prefix}-T3`,
      name: names[2],
      tier: 3,
      categoryCode: categories[2],
      rowCount: 10,
      seatsPerRow: 20,
      elevationBaseM: 15.2,
      riserHeightM: d.riserHeightByTierM[3],
      rowDepthM: d.rowDepthM,
      seatWidthM: d.seatWidthM,
      rakeAngleDeg: computeRakeDeg(d.riserHeightByTierM[3], d.rowDepthM),
      radialOffsetM: 23.2,
    },
  ];
}

export const DEFAULT_STADIUM_SPEC: StadiumSpec = {
  code: 'STADIUMX_OVAL_01',
  name: 'Sovereign International Cricket Arena',
  city: 'Ahmedabad',
  country: 'India',
  semiMajorAxisX: 84,
  semiMinorAxisZ: 72,
  boundaryRatio: 0.9,
  roofInnerRadiusX: 92,
  roofInnerRadiusZ: 80,
  roofOuterRadiusX: 124,
  roofOuterRadiusZ: 112,
  roofHeightM: 29.5,
  rowSpacingM: DEFAULT_SEATING_DIMENSIONS.rowDepthM,
  seatSpacingM: DEFAULT_SEATING_DIMENSIONS.seatWidthM,
  dimensions: DEFAULT_SEATING_DIMENSIONS,
  scoreboardAnglesDeg: [45, 225],
  pillarAnglesDeg: [15, 75, 105, 165, 195, 255, 285, 345],
  categories: [
    {
      code: 'VIP_LOUNGE',
      name: 'Presidential VIP Lounge',
      colorHex: '#1D4ED8',
      seatPlasticHex: '#1E40AF',
      basePricePaise: 650000, // ₹6,500
      isCovered: true,
      tierLevel: 2,
      description: 'Climate-controlled glass club deck dead-straight behind the sight screen with complimentary hospitality.',
    },
    {
      code: 'HOSPITALITY_BOX',
      name: 'Skyline Corporate Box',
      colorHex: '#2563EB',
      seatPlasticHex: '#1D4ED8',
      basePricePaise: 480000, // ₹4,800
      isCovered: true,
      tierLevel: 2,
      description: 'Elevated mid-tier executive suites with private lounge access, padded ergonomic seating, and full roof shade.',
    },
    {
      code: 'PAVILION_CLUB',
      name: 'Pavilion Club Lower',
      colorHex: '#0284C7',
      seatPlasticHex: '#0369A1',
      basePricePaise: 320000, // ₹3,200
      isCovered: false,
      tierLevel: 1,
      description: 'Lower-bowl molded blue bucket seats directly adjacent to the player dressing rooms and walkout tunnel.',
    },
    {
      code: 'LOWER_BOWL',
      name: 'Championship Lower Bowl',
      colorHex: '#0EA5E9',
      seatPlasticHex: '#0284C7',
      basePricePaise: 180000, // ₹1,800
      isCovered: false,
      tierLevel: 1,
      description: 'High-energy boundary-side action closest to the turf and 30-yard fielding circle.',
    },
    {
      code: 'UPPER_TIER',
      name: 'Panoramic Upper Terrace',
      colorHex: '#3B82F6',
      seatPlasticHex: '#2563EB',
      basePricePaise: 95000, // ₹950
      isCovered: true,
      tierLevel: 3,
      description: 'Commanding tactical bird’s-eye view of field placements under the cantilevered steel truss canopy.',
    },
  ],
  stands: [
    {
      code: 'NORTH',
      name: 'North Pavilion End',
      shortName: 'North Pavilion',
      orientationAngleDeg: 0,
      arcSpanDeg: 42,
      blocks: createStandBlocks(
        'N',
        ['North Pavilion Lower', 'North Presidential VIP', 'North Canopy Terrace'],
        ['PAVILION_CLUB', 'VIP_LOUNGE', 'UPPER_TIER']
      ),
    },
    {
      code: 'NORTH_EAST',
      name: 'North-East Scoreboard Stand',
      shortName: 'NE Stand',
      orientationAngleDeg: 45,
      arcSpanDeg: 42,
      blocks: createStandBlocks(
        'NE',
        ['NE Boundary Lower', 'NE Skyline Suite', 'NE Upper Deck'],
        ['LOWER_BOWL', 'HOSPITALITY_BOX', 'UPPER_TIER']
      ),
    },
    {
      code: 'EAST',
      name: 'East Colonnade Stand',
      shortName: 'East Stand',
      orientationAngleDeg: 90,
      arcSpanDeg: 42,
      blocks: createStandBlocks(
        'E',
        ['East Square Lower', 'East Executive Club', 'East Panorama Tier'],
        ['LOWER_BOWL', 'HOSPITALITY_BOX', 'UPPER_TIER']
      ),
    },
    {
      code: 'SOUTH_EAST',
      name: 'South-East Centennial Stand',
      shortName: 'SE Stand',
      orientationAngleDeg: 135,
      arcSpanDeg: 42,
      blocks: createStandBlocks(
        'SE',
        ['SE Boundary Lower', 'SE Club Deck', 'SE Upper Terrace'],
        ['LOWER_BOWL', 'HOSPITALITY_BOX', 'UPPER_TIER']
      ),
    },
    {
      code: 'SOUTH',
      name: 'South Media & Sight-Screen End',
      shortName: 'South End',
      orientationAngleDeg: 180,
      arcSpanDeg: 42,
      blocks: createStandBlocks(
        'S',
        ['South Sight-Screen Lower', 'South Broadcast VIP Lounge', 'South Canopy Upper'],
        ['PAVILION_CLUB', 'VIP_LOUNGE', 'UPPER_TIER']
      ),
    },
    {
      code: 'SOUTH_WEST',
      name: 'South-West Giant Screen Stand',
      shortName: 'SW Stand',
      orientationAngleDeg: 225,
      arcSpanDeg: 42,
      blocks: createStandBlocks(
        'SW',
        ['SW Boundary Lower', 'SW Skyline Suite', 'SW Upper Terrace'],
        ['LOWER_BOWL', 'HOSPITALITY_BOX', 'UPPER_TIER']
      ),
    },
    {
      code: 'WEST',
      name: 'West Members Grandstand',
      shortName: 'West Stand',
      orientationAngleDeg: 270,
      arcSpanDeg: 42,
      blocks: createStandBlocks(
        'W',
        ['West Members Lower', 'West Royal Hospitality', 'West Sunset Canopy'],
        ['LOWER_BOWL', 'VIP_LOUNGE', 'UPPER_TIER']
      ),
    },
    {
      code: 'NORTH_WEST',
      name: 'North-West Family & Fan Zone',
      shortName: 'NW Family Stand',
      orientationAngleDeg: 315,
      arcSpanDeg: 42,
      blocks: createStandBlocks(
        'NW',
        ['NW Family Lower Bowl', 'NW Club Lounge', 'NW Upper Terrace'],
        ['LOWER_BOWL', 'HOSPITALITY_BOX', 'UPPER_TIER']
      ),
    },
  ],
  hotspots: [
    {
      id: 'HS_PAVILION',
      label: 'Players Pavilion & Walkout Tunnel',
      category: 'PAVILION',
      description: 'Home & Visiting dressing rooms, match referee suite, and glass walkout stairs to the turf.',
      position: [0, 6, -80],
    },
    {
      id: 'HS_VIP_LOUNGE',
      label: 'Sovereign Sky Club & Dining Deck',
      category: 'LOUNGE',
      description: 'Climate-controlled hospitality lounge behind the North sight-screen with private bar and buffet.',
      position: [0, 11, -96],
    },
    {
      id: 'HS_SCOREBOARD_NE',
      label: 'North-East 8K Giant LED Matrix',
      category: 'SCOREBOARD',
      description: '32m x 14m ultra-bright HDR replay screen, Hawk-Eye ball tracking telemetry, and live wagon wheel.',
      position: [72, 26, -64],
    },
    {
      id: 'HS_FOOD_EAST',
      label: 'East Concourse Culinary Plaza & Restrooms',
      category: 'FOOD_COURT',
      description: '14 express refreshment counters, filtered hydration stations, and accessible restrooms at Gate 3.',
      position: [104, 8, 0],
    },
    {
      id: 'HS_MEDICAL_SW',
      label: 'First Aid & Fan Welfare Center',
      category: 'MEDICAL',
      description: 'St. John Ambulance emergency bay, wheelchair assistance desk, and shaded cooling station.',
      position: [-74, 5, 64],
    },
    {
      id: 'HS_GATE_MAIN',
      label: 'Grand West Metro Plaza & Gate 1',
      category: 'GATE',
      description: 'Primary high-throughput QR turnstiles, VIP valet drop-off, and metro skywalk connection.',
      position: [-112, 4, 0],
    },
  ],
};

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

function normalizeAngleDiffDeg(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}

/**
 * Deterministic 32-bit FNV-1a + Murmur3 finalizer hash from seatCode & salt.
 * Returns a float in [0, 1). Guarantees 100% identical values on server, DB, and WebGL client.
 */
export function deterministicSeatRandom01(seatCode: string, salt = 0): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < seatCode.length; i++) {
    h ^= seatCode.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Computes the local curvature radius of the stadium bowl ellipse at polar angle thetaRad.
 */
function computeLocalEllipseRadius(rx: number, rz: number, thetaRad: number): number {
  const dx = rx * Math.cos(thetaRad);
  const dz = rz * Math.sin(thetaRad);
  return Math.max(40, Math.hypot(dx, dz));
}

/**
 * Computes the angular offset (in degrees) from a stand's centreline for seat s in [1..20].
 * Distributes the 20 seat bays across the full 40.8° active seating arc of each 42° stand:
 * - Left Wing Sub-Block (s = 1..6):   [-20.4°, -8.4°]  (centers at -19.4° .. -9.4°, 2.0° spacing)
 * - Radial Stair Aisle 1:             [-8.4°,  -6.8°]  (1.6° clear radial staircase)
 * - Center Bay Sub-Block (s = 7..14): [-6.8°,  +6.8°]  (centers at -5.95° .. +5.95°, 1.7° spacing)
 * - Radial Stair Aisle 2:             [+6.8°,  +8.4°]  (1.6° clear radial staircase)
 * - Right Wing Sub-Block (s = 15..20):[+8.4°, +20.4°]  (centers at +9.4° .. +19.4°, 2.0° spacing)
 */
export function computeSeatDeltaAngleDeg(seatNumber: number): number {
  if (seatNumber <= 6) {
    return -20.4 + (seatNumber - 0.5) * 2.0;
  }
  if (seatNumber <= 14) {
    return -6.8 + (seatNumber - 6.5) * 1.7;
  }
  return 8.4 + (seatNumber - 14.5) * 2.0;
}

/**
 * Number of contiguous 0.48 m-spaced 3D spectator seats rendered per database seat anchor.
 * 4,800 database seat anchors × 7 contiguous 3D seats = 33,600 individual 3D seats filling all 24 sections across 360°.
 * Sub-index 3 (offset 0) is at the exact (posX, posY, posZ, rotY) coordinate of the PostgreSQL seat record.
 */
export const SEAT_SUB_INSTANCES_PER_ANCHOR = 7;

export interface ContiguousSeatSubTransform {
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  subOffset: number;
}

/**
 * Computes the exact 3D world transform for each of the 7 contiguous 0.48 m-spaced 3D seats
 * belonging to a database seat anchor along its curved elliptical concrete tier step.
 */
export function computeContiguousSeatSubTransform(
  seat: Pick<GeneratedSeat, 'tier' | 'rowNumber' | 'posX' | 'posY' | 'posZ' | 'rotY'> & {
    baseRotY?: number;
  },
  subIdx: number,
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): ContiguousSeatSubTransform {
  const subOffset = subIdx - Math.floor(SEAT_SUB_INSTANCES_PER_ANCHOR / 2); // -3, -2, -1, 0, +1, +2, +3
  if (subOffset === 0) {
    return {
      posX: seat.posX,
      posY: seat.posY,
      posZ: seat.posZ,
      rotY: seat.rotY,
      subOffset: 0,
    };
  }

  const dims = spec.dimensions || DEFAULT_SEATING_DIMENSIONS;
  const tierOffsetM = seat.tier === 1 ? 4.0 : seat.tier === 2 ? 13.6 : 23.2;
  const radialOffset = tierOffsetM + (seat.rowNumber - 1) * dims.rowDepthM;
  const rx = spec.semiMajorAxisX + radialOffset;
  const rz = spec.semiMinorAxisZ + radialOffset;

  const anchorAngleRad = Math.atan2(seat.posX / rx, -seat.posZ / rz);
  const localRadiusM = computeLocalEllipseRadius(rx, rz, anchorAngleRad);
  const lateralArcOffsetM = subOffset * dims.seatWidthM; // exact 0.48 m center-to-center seat spacing
  const subAngleRad = anchorAngleRad + lateralArcOffsetM / localRadiusM;

  const posX = Number((rx * Math.sin(subAngleRad)).toFixed(4));
  const posZ = Number((-rz * Math.cos(subAngleRad)).toFixed(4));
  const baseAnchorRotY = seat.baseRotY ?? Math.atan2(-seat.posX, -seat.posZ);
  const jitterRad = seat.rotY - baseAnchorRotY;
  const rotY = Number((Math.atan2(-posX, -posZ) + jitterRad).toFixed(5));

  return {
    posX,
    posY: seat.posY,
    posZ,
    rotY,
    subOffset,
  };
}

/**
 * Generates metadata for every curved concrete row step across all 24 blocks (240 rows total).
 * Used both for procedural bowl step/riser/aisle/parapet generation and validation.
 */
export function generateBowlRowCurvesFromSpec(
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): BowlRowCurveMetadata[] {
  const rows: BowlRowCurveMetadata[] = [];
  const dims = spec.dimensions || DEFAULT_SEATING_DIMENSIONS;

  for (const stand of spec.stands) {
    const centerRad = degToRad(stand.orientationAngleDeg);
    const halfSpanRad = degToRad(stand.arcSpanDeg / 2);

    for (const block of stand.blocks) {
      const rowDepthM = block.rowDepthM || dims.rowDepthM;
      const riserHeightM = block.riserHeightM || dims.riserHeightByTierM[block.tier];

      for (let r = 1; r <= block.rowCount; r++) {
        const radialOffset = block.radialOffsetM + (r - 1) * rowDepthM;
        const stepElevationY = Number((block.elevationBaseM + (r - 1) * riserHeightM).toFixed(4));
        const ellipseRadiusX = Number((spec.semiMajorAxisX + radialOffset).toFixed(4));
        const ellipseRadiusZ = Number((spec.semiMinorAxisZ + radialOffset).toFixed(4));

        // Two radial stair aisles at ±7.6° from stand centreline divide each stand into 3 sub-blocks
        const aisleOffsetRad = degToRad(7.6);

        rows.push({
          standCode: stand.code,
          blockCode: block.code,
          tier: block.tier,
          rowNumber: r,
          stepElevationY,
          riserHeightM,
          rowDepthM,
          ellipseRadiusX,
          ellipseRadiusZ,
          startAngleRad: centerRad - halfSpanRad,
          endAngleRad: centerRad + halfSpanRad,
          aisleAnglesRad: [
            centerRad - aisleOffsetRad,
            centerRad + aisleOffsetRad,
          ],
        });
      }
    }
  }

  return rows;
}

/**
 * Generates all 4,800 seats deterministically from the parametric StadiumSpec across the full 360° bowl.
 * World coordinates: 1 unit = 1 metre, Y-up, pitch centre at (0, 0, 0),
 * pitch strip runs along Z axis from -10.06m (North end) to +10.06m (South end).
 *
 * Enforces Section A exact dimensions & full 360° stadium bowl coverage:
 * - Full 8 stands × 3 tiers = 24 sections spanning 42° per stand around the entire 360° ellipse
 * - Seat lateral pitch: 0.48 m along the curved row ellipse (7 contiguous 3D seats per DB anchor = 33,600 3D seats)
 * - Row horizontal going: 0.80 m
 * - Riser height per tier: 0.30 m (Tier 1), 0.36 m (Tier 2), 0.42 m (Tier 3)
 * - Cushion height: +0.42 m above step; backrest top: +0.85 m above step
 * - Seated eye height: +1.15 m above step surface
 * - Radial stair aisles between seats 6-7 (-7.6°) and 14-15 (+7.6°)
 * - Deterministic per-seat yaw jitter within ±0.5° and micro height variation within ±3.5 mm
 */
export function generateSeatsFromSpec(spec: StadiumSpec = DEFAULT_STADIUM_SPEC): GeneratedSeat[] {
  const generated: GeneratedSeat[] = [];
  const dims = spec.dimensions || DEFAULT_SEATING_DIMENSIONS;
  let instanceIndex = 0;

  for (const stand of spec.stands) {
    const centerAngleDeg = stand.orientationAngleDeg;

    for (const block of stand.blocks) {
      const rowDepthM = block.rowDepthM || dims.rowDepthM; // 0.80 m going
      const riserHeightM = block.riserHeightM || dims.riserHeightByTierM[block.tier]; // 0.30 / 0.36 / 0.42 m

      for (let r = 1; r <= block.rowCount; r++) {
        // Horizontal going step and vertical riser step
        const radialOffset = block.radialOffsetM + (r - 1) * rowDepthM;
        const stepSurfaceY = Number((block.elevationBaseM + (r - 1) * riserHeightM).toFixed(4));
        const rx = spec.semiMajorAxisX + radialOffset;
        const rz = spec.semiMinorAxisZ + radialOffset;

        for (let s = 1; s <= block.seatsPerRow; s++) {
          const rowPad = String(r).padStart(2, '0');
          const seatPad = String(s).padStart(2, '0');
          const seatCode = `${block.code}-R${rowPad}-S${seatPad}`;

          // Full-stand angular distribution across [-20.4°, +20.4°] with 2 radial stair aisles at ±7.6°
          const deltaAngleDeg = computeSeatDeltaAngleDeg(s);
          const seatAngleDeg = (centerAngleDeg + deltaAngleDeg + 360) % 360;
          const seatAngleRad = degToRad(seatAngleDeg);

          // Angle 0 = North (0, y, -rz), Angle 90 = East (+rx, y, 0), Angle 180 = South (0, y, +rz), Angle 270 = West (-rx, y, 0)
          const posX = Number((rx * Math.sin(seatAngleRad)).toFixed(4));
          const posZ = Number((-rz * Math.cos(seatAngleRad)).toFixed(4));

          // Deterministic micro-variations seeded by seatCode
          const randYaw = deterministicSeatRandom01(seatCode, 101) * 2 - 1; // [-1, +1]
          const randHeight = deterministicSeatRandom01(seatCode, 202) * 2 - 1; // [-1, +1]
          const wearFactor = Number(
            (0.05 + deterministicSeatRandom01(seatCode, 303) * 0.30).toFixed(4)
          );
          const colorVariationSeed = Number(
            deterministicSeatRandom01(seatCode, 404).toFixed(4)
          );

          const yawJitterDeg = Number((randYaw * dims.maxYawJitterDeg).toFixed(4)); // within [-0.5°, +0.5°]
          const heightJitterM = Number((randHeight * dims.maxHeightJitterM).toFixed(4)); // within [-0.0035m, +0.0035m]

          const posY = Number((stepSurfaceY + heightJitterM).toFixed(4));
          const cushionSurfaceY = Number((posY + dims.seatCushionHeightM).toFixed(4));
          const backrestTopY = Number((posY + dims.seatBackrestTopHeightM).toFixed(4));
          const eyePosY = Number((posY + dims.seatedEyeHeightAboveStepM).toFixed(4));

          // Base yaw facing pitch centre (0, 0, 0) + deterministic ±0.5° yaw jitter
          const baseRotY = Number(Math.atan2(-posX, -posZ).toFixed(5));
          const rotY = Number((baseRotY + degToRad(yawJitterDeg)).toFixed(5));

          const groundDist = Math.hypot(posX, posZ);
          const distanceToPitchM = Number(Math.hypot(groundDist, posY).toFixed(2));

          // Boundary radius along this ray
          const boundaryRx = spec.semiMajorAxisX * spec.boundaryRatio;
          const boundaryRz = spec.semiMinorAxisZ * spec.boundaryRatio;
          const boundaryX = boundaryRx * Math.sin(seatAngleRad);
          const boundaryZ = -boundaryRz * Math.cos(seatAngleRad);
          const distanceToBoundaryM = Number(
            Math.hypot(posX - boundaryX, posZ - boundaryZ, posY).toFixed(2)
          );

          const elevationAngleDeg = Number(radToDeg(Math.atan2(eyePosY, groundDist)).toFixed(2));

          // Horizontal angle relative to the pitch axis (0° = straight down the pitch from North or South end, 90° = square wicket)
          const offNorth = normalizeAngleDiffDeg(seatAngleDeg, 0);
          const offSouth = normalizeAngleDiffDeg(seatAngleDeg, 180);
          const horizontalAngleDeg = Number(Math.min(offNorth, offSouth).toFixed(2));

          // Scoreboard visibility: visible unless the spectator is sitting directly underneath/behind the scoreboard structure itself
          const minScoreboardDiff = Math.min(
            ...spec.scoreboardAnglesDeg.map((sb) => normalizeAngleDiffDeg(seatAngleDeg, sb))
          );
          const scoreboardVisible = !(minScoreboardDiff < 9 && block.tier === 3);

          // Pillar or roof edge check
          const minPillarDiff = Math.min(
            ...spec.pillarAnglesDeg.map((p) => normalizeAngleDiffDeg(seatAngleDeg, p))
          );
          let obstructionWarning = 'NONE';
          if (block.tier === 3 && r >= 9 && minPillarDiff < 2.2) {
            obstructionWarning = 'Minor roof truss stanchion near peripheral sightline';
          } else if (!scoreboardVisible) {
            obstructionWarning = 'Primary NE/SW scoreboard directly overhead; secondary opposite scoreboard visible';
          }

          // Afternoon shade % (at 15:30 local time, sun in West-South-West)
          const baseRoofShade =
            block.tier === 3
              ? 78 + r * 2
              : block.tier === 2
              ? 68 + r * 2
              : 18 + r * 3;
          const westernBonus =
            normalizeAngleDiffDeg(seatAngleDeg, 245) < 70 ? 18 : 0;
          const shadeAfternoonPct = Math.min(100, Math.max(10, Math.round(baseRoofShade + westernBonus)));

          // View Quality Score (0..100)
          const angleBonus = Math.max(0, 32 - horizontalAngleDeg * 0.35);
          const idealElevDiff = Math.abs(elevationAngleDeg - 14.5);
          const elevationScore = Math.max(0, 28 - idealElevDiff * 1.3);
          const distanceScore = Math.max(0, 24 - Math.max(0, distanceToPitchM - 78) * 0.32);
          const comfortBonus =
            block.categoryCode === 'VIP_LOUNGE'
              ? 16
              : block.categoryCode === 'HOSPITALITY_BOX'
              ? 13
              : block.categoryCode === 'PAVILION_CLUB'
              ? 11
              : block.categoryCode === 'LOWER_BOWL'
              ? 8
              : 7;
          const obstructionPenalty = obstructionWarning === 'NONE' ? 0 : 12;

          const rawScore = Math.round(
            angleBonus + elevationScore + distanceScore + comfortBonus - obstructionPenalty
          );
          const viewQualityScore = Math.max(42, Math.min(99, rawScore));

          generated.push({
            seatCode,
            standCode: stand.code,
            standName: stand.name,
            blockCode: block.code,
            blockName: block.name,
            categoryCode: block.categoryCode,
            tier: block.tier,
            rowNumber: r,
            seatNumber: s,
            instanceIndex,
            posX,
            posY,
            posZ,
            stepSurfaceY,
            cushionSurfaceY,
            backrestTopY,
            eyePosY,
            rotY,
            baseRotY,
            yawJitterDeg,
            heightJitterM,
            wearFactor,
            colorVariationSeed,
            distanceToPitchM,
            distanceToBoundaryM,
            elevationAngleDeg,
            horizontalAngleDeg,
            scoreboardVisible,
            obstructionWarning,
            shadeAfternoonPct,
            viewQualityScore,
          });

          instanceIndex++;
        }
      }
    }
  }

  return generated;
}

/**
 * Computes dynamic time-of-day solar raycast shade & sightline telemetry for any seat.
 * Seated eye height is placed at exactly +1.15 m above the step surface.
 */
export function computeSeatViewTelemetry(
  seat: Pick<
    GeneratedSeat,
    | 'seatCode'
    | 'tier'
    | 'rowNumber'
    | 'posX'
    | 'posY'
    | 'posZ'
    | 'distanceToPitchM'
    | 'distanceToBoundaryM'
    | 'elevationAngleDeg'
    | 'horizontalAngleDeg'
    | 'scoreboardVisible'
    | 'obstructionWarning'
    | 'shadeAfternoonPct'
    | 'viewQualityScore'
  >,
  timeOfDayHours = 15.5,
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): ViewTelemetryBreakdown {
  const dims = spec.dimensions || DEFAULT_SEATING_DIMENSIONS;
  const clampedHour = Math.max(8, Math.min(22, timeOfDayHours));
  let sunElevationDeg = 0;
  let sunAzimuthDeg = 180;

  if (clampedHour >= 18.5) {
    sunElevationDeg = 0;
    sunAzimuthDeg = 275;
  } else {
    const dayProgress = (clampedHour - 8) / 10.5;
    sunElevationDeg = Number((Math.sin(dayProgress * Math.PI) * 68).toFixed(1));
    sunAzimuthDeg = Number((90 + dayProgress * 180).toFixed(1));
  }

  const seatAngleDeg = (radToDeg(Math.atan2(seat.posX, -seat.posZ)) + 360) % 360;
  const nearestScoreboardAngleDiffDeg = Number(
    Math.min(
      ...spec.scoreboardAnglesDeg.map((sb) => normalizeAngleDiffDeg(seatAngleDeg, sb))
    ).toFixed(1)
  );

  let shadePctAtTime = 100;
  if (sunElevationDeg > 2) {
    const sunDiff = normalizeAngleDiffDeg(seatAngleDeg, sunAzimuthDeg);
    const shellShadowFactor = sunDiff < 85 ? 32 : sunDiff > 130 ? -15 : 5;
    const canopyFactor =
      seat.tier === 3
        ? 72 + seat.rowNumber * 2.2
        : seat.tier === 2
        ? 58 + seat.rowNumber * 2.5
        : 15 + seat.rowNumber * 2.8;
    const lowSunBonus = sunElevationDeg < 28 ? 22 : 0;
    shadePctAtTime = Math.max(5, Math.min(100, Math.round(canopyFactor + shellShadowFactor + lowSunBonus)));
  }

  const sightlineCategory: ViewTelemetryBreakdown['sightlineCategory'] =
    seat.horizontalAngleDeg <= 24
      ? 'Straight-On Bowler/Batter Arm'
      : seat.horizontalAngleDeg <= 58
      ? 'Diagonal Mid-Wicket / Cover'
      : 'Square Point / Square Leg';

  const shadePhrase =
    sunElevationDeg <= 2
      ? 'floodlit night conditions with zero solar glare'
      : shadePctAtTime >= 75
      ? `full canopy shade (${shadePctAtTime}%) at ${formatHourLabel(clampedHour)}`
      : shadePctAtTime >= 45
      ? `partial roof shade (${shadePctAtTime}%) at ${formatHourLabel(clampedHour)}`
      : `open sunlit bowl (${shadePctAtTime}% shade) at ${formatHourLabel(clampedHour)}`;

  const sightlinePhrase =
    seat.horizontalAngleDeg <= 22
      ? 'Elite straight-on sightline directly down the 22-yard pitch axis'
      : seat.horizontalAngleDeg <= 55
      ? 'Balanced diagonal sightline ideal for tracking swing and cover drives'
      : 'Commanding square-of-the-wicket angle for crease & run-out judgment';

  const summaryExplanation = `${sightlinePhrase}, ${seat.distanceToPitchM}m from centre wicket (${seat.elevationAngleDeg}° elevation), with ${shadePhrase}.`;

  // Exact 1.15 m seated eye height above the step surface
  const eyeY = Number((seat.posY + dims.seatedEyeHeightAboveStepM).toFixed(4));

  return {
    seatCode: seat.seatCode,
    distanceToPitchM: seat.distanceToPitchM,
    distanceToBoundaryM: seat.distanceToBoundaryM,
    elevationAngleDeg: seat.elevationAngleDeg,
    horizontalAngleDeg: seat.horizontalAngleDeg,
    sightlineCategory,
    scoreboardVisible: seat.scoreboardVisible,
    nearestScoreboardAngleDiffDeg,
    obstructionWarning: seat.obstructionWarning,
    shadePctAtTime,
    sunElevationDeg,
    sunAzimuthDeg,
    viewQualityScore: seat.viewQualityScore,
    summaryExplanation,
    eyePosition: [seat.posX, eyeY, seat.posZ],
    lookAtTarget: [0, 0.8, 0],
  };
}

function formatHourLabel(hourFloat: number): string {
  const h = Math.floor(hourFloat);
  const m = Math.round((hourFloat - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeDynamicPricePaise(
  basePricePaise: number,
  multipliers: { demand: number; rivalry: number; weekend: number }
): { combinedMultiplier: number; finalPricePaise: number } {
  const combinedMultiplier = Number(
    (multipliers.demand * multipliers.rivalry * multipliers.weekend).toFixed(3)
  );
  const finalPricePaise = Math.round((basePricePaise * combinedMultiplier) / 1000) * 1000;
  return { combinedMultiplier, finalPricePaise };
}

export interface SeatWithInventory extends Partial<GeneratedSeat> {
  id: number;
  seatCode: string;
  standCode: StandSpec['code'];
  standName: string;
  blockCode: string;
  blockName: string;
  categoryCode: SeatCategorySpec['code'];
  tier: number;
  rowNumber: number;
  seatNumber: number;
  instanceIndex: number;
  posX: number;
  posY: number;
  posZ: number;
  rotY: number;
  distanceToPitchM: number;
  distanceToBoundaryM: number;
  elevationAngleDeg: number;
  horizontalAngleDeg: number;
  scoreboardVisible: boolean;
  obstructionWarning: string;
  shadeAfternoonPct: number;
  viewQualityScore: number;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  pricePaise: number;
  categoryName: string;
  isCovered?: boolean;
}

/**
 * Finds and ranks available seat groups matching user preferences and real-time DB inventory.
 */
export function recommendSeats(
  seats: SeatWithInventory[],
  prefs: RecommendationPreferences,
  limit = 8
): SeatRecommendationGroup[] {
  const groupSize = Math.max(1, Math.min(6, prefs.groupSize));
  const requireAdjacent = prefs.requireAdjacentSeats !== false;
  const preferredCat =
    prefs.preferredCategoryCode && prefs.preferredCategoryCode !== 'ALL'
      ? prefs.preferredCategoryCode
      : null;
  const preferredStand =
    prefs.preferredStandCode && prefs.preferredStandCode !== 'ALL'
      ? prefs.preferredStandCode
      : null;
  const candidates: SeatRecommendationGroup[] = [];

  const availablePerBlock = new Map<string, number>();
  const byBlockRow = new Map<string, SeatWithInventory[]>();
  const byBlock = new Map<string, SeatWithInventory[]>();

  for (const s of seats) {
    if (s.status !== 'AVAILABLE') continue;
    availablePerBlock.set(s.blockCode, (availablePerBlock.get(s.blockCode) ?? 0) + 1);
    if (preferredCat && s.categoryCode !== preferredCat) continue;
    if (preferredStand && s.standCode !== preferredStand) continue;
    if (prefs.budgetPerSeatPaise > 0 && s.pricePaise > prefs.budgetPerSeatPaise) continue;

    const rowKey = `${s.blockCode}:${s.rowNumber}`;
    let rowList = byBlockRow.get(rowKey);
    if (!rowList) {
      rowList = [];
      byBlockRow.set(rowKey, rowList);
    }
    rowList.push(s);

    let blockList = byBlock.get(s.blockCode);
    if (!blockList) {
      blockList = [];
      byBlock.set(s.blockCode, blockList);
    }
    blockList.push(s);
  }

  const scoreGroup = (
    slice: SeatWithInventory[],
    seatsTogether: boolean
  ): SeatRecommendationGroup => {
    const first = slice[0];
    const avgView = Math.round(
      slice.reduce((acc, item) => acc + item.viewQualityScore, 0) / slice.length
    );
    const avgShade = Math.round(
      slice.reduce((acc, item) => acc + item.shadeAfternoonPct, 0) / slice.length
    );
    const avgPitchDist = Number(
      (slice.reduce((acc, item) => acc + item.distanceToPitchM, 0) / slice.length).toFixed(1)
    );
    const avgElev = Number(
      (slice.reduce((acc, item) => acc + item.elevationAngleDeg, 0) / slice.length).toFixed(1)
    );
    const avgHoriz = Number(
      (slice.reduce((acc, item) => acc + item.horizontalAngleDeg, 0) / slice.length).toFixed(1)
    );
    const scoreboardVisible = slice.every((item) => item.scoreboardVisible);
    const isAisleEntrance = slice.some(
      (item) =>
        item.rowNumber >= 8 ||
        [1, 6, 7, 14, 15, 20].includes(item.seatNumber)
    );

    const viewWeight = prefs.preferBestView ? 1.35 : 1.0;
    let matchScore = avgView * viewWeight;
    const reasons: string[] = [`View quality ${avgView}/100`];

    if (prefs.preferBestView && avgView >= 84) {
      reasons.push('top-decile overall sightline');
    }
    if (prefs.preferShade) {
      matchScore += avgShade * 0.38;
      if (avgShade >= 70) reasons.push(`${avgShade}% afternoon roof shade`);
    }
    if (prefs.preferStraightView) {
      const straightBonus = Math.max(0, 38 - avgHoriz) * 0.95;
      matchScore += straightBonus;
      if (avgHoriz <= 24) reasons.push(`straight-on ${avgHoriz}° pitch axis angle`);
    }
    if (prefs.preferCloseToPitch) {
      const proximityBonus = Math.max(0, 122 - avgPitchDist) * 0.55;
      matchScore += proximityBonus;
      if (avgPitchDist <= 95) reasons.push(`${avgPitchDist}m close to pitch`);
    }
    if (prefs.preferBestElevation) {
      // Ideal cricket elevation between 10° and 22°
      const elevDelta = Math.abs(avgElev - 15.5);
      const elevBonus = Math.max(0, 18 - elevDelta) * 1.15;
      matchScore += elevBonus;
      if (avgElev >= 9 && avgElev <= 23) reasons.push(`${avgElev}° elevated rake angle`);
    }
    if (prefs.preferNearEntrance) {
      if (isAisleEntrance) {
        matchScore += 18;
        reasons.push('easy aisle & vomitory entrance access');
      }
    }
    if (prefs.preferFamilyZone) {
      if (first.standCode === 'NORTH_WEST' || first.tier === 2 || (first.isCovered ?? first.tier >= 2)) {
        matchScore += 16;
        reasons.push(
          first.standCode === 'NORTH_WEST'
            ? 'NW Family Zone concourse'
            : 'covered family-friendly tier'
        );
      }
    }
    if (scoreboardVisible) {
      matchScore += 4;
      reasons.push('unobstructed 8K scoreboard view');
    }
    if (seatsTogether && groupSize > 1) {
      matchScore += 10;
      reasons.push(`${slice.length} adjacent seats together`);
    }
    if (prefs.budgetPerSeatPaise > 0) {
      const budgetRatio = first.pricePaise / prefs.budgetPerSeatPaise;
      matchScore += (1 - budgetRatio * 0.25) * 10;
    }

    const totalPricePaise = slice.reduce((acc, item) => acc + item.pricePaise, 0);
    const pricePerSeatPaise = Math.round(totalPricePaise / slice.length);

    return {
      groupId: `${first.blockCode}-R${first.rowNumber}-S${first.seatNumber}-${seatsTogether ? 'ADJ' : 'FLEX'}`,
      standCode: first.standCode,
      standName: first.standName,
      blockCode: first.blockCode,
      blockName: first.blockName,
      tier: first.tier,
      categoryName: first.categoryName,
      categoryCode: first.categoryCode,
      rowNumber: first.rowNumber,
      seatNumbers: slice.map((x) => x.seatNumber),
      seatCodes: slice.map((x) => x.seatCode),
      seatIds: slice.map((x) => x.id),
      instanceIndices: slice.map((x) => x.instanceIndex),
      totalPricePaise,
      pricePerSeatPaise,
      averageViewScore: avgView,
      averageShadePct: avgShade,
      distanceToPitchM: avgPitchDist,
      elevationAngleDeg: avgElev,
      horizontalAngleDeg: avgHoriz,
      scoreboardVisible,
      seatsTogether,
      availableInBlockCount: availablePerBlock.get(first.blockCode) ?? 0,
      reasons,
      matchScore: Number(matchScore.toFixed(1)),
      explanation: `${slice.length} ${seatsTogether && groupSize > 1 ? 'adjacent ' : ''}seat${slice.length > 1 ? 's' : ''} in ${first.blockName} (Row ${first.rowNumber}) — ${reasons.join(' · ')}.`,
    };
  };

  for (const [, rowSeats] of byBlockRow) {
    rowSeats.sort((a, b) => a.seatNumber - b.seatNumber);

    for (let i = 0; i <= rowSeats.length - groupSize; i++) {
      const slice = rowSeats.slice(i, i + groupSize);
      let isContiguous = true;
      for (let k = 1; k < slice.length; k++) {
        const prev = slice[k - 1].seatNumber;
        const curr = slice[k].seatNumber;
        if (curr !== prev + 1 || prev === 6 || prev === 14) {
          isContiguous = false;
          break;
        }
      }
      if (!isContiguous) continue;
      candidates.push(scoreGroup(slice, true));
      i += Math.max(1, Math.floor(groupSize / 2));
    }
  }

  // When user allows split seating ("Seats together" unchecked) and adjacent options are scarce
  if (!requireAdjacent && groupSize > 1) {
    for (const [, blockSeats] of byBlock) {
      if (blockSeats.length < groupSize) continue;
      const topInBlock = [...blockSeats]
        .sort((a, b) => b.viewQualityScore - a.viewQualityScore)
        .slice(0, groupSize);
      candidates.push(scoreGroup(topInBlock, false));
    }
  }

  const sortBy = prefs.sortBy || 'MATCH_SCORE';
  candidates.sort((a, b) => {
    if (sortBy === 'PRICE_ASC') {
      return a.pricePerSeatPaise - b.pricePerSeatPaise || b.matchScore - a.matchScore;
    }
    if (sortBy === 'VIEW_SCORE') {
      return b.averageViewScore - a.averageViewScore || b.matchScore - a.matchScore;
    }
    if (sortBy === 'CLOSEST_PITCH') {
      return a.distanceToPitchM - b.distanceToPitchM || b.matchScore - a.matchScore;
    }
    if (sortBy === 'SHADE') {
      return b.averageShadePct - a.averageShadePct || b.matchScore - a.matchScore;
    }
    return b.matchScore - a.matchScore;
  });

  const diverse: SeatRecommendationGroup[] = [];
  const countPerBlock = new Map<string, number>();
  for (const c of candidates) {
    const used = countPerBlock.get(c.blockCode) ?? 0;
    if (used >= 2) continue;
    countPerBlock.set(c.blockCode, used + 1);
    diverse.push(c);
    if (diverse.length >= limit) break;
  }

  return diverse;
}
