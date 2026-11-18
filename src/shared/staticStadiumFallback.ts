import {
  DEFAULT_STADIUM_SPEC,
  computeDynamicPricePaise,
  generateSeatsFromSpec,
  type StadiumSpec,
} from './stadiumSpec';

export interface DeterministicStaticSeatRecord {
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
  seatPlasticHex: string;
  isCovered: boolean;
  tier: number;
  rowNumber: number;
  seatNumber: number;
  instanceIndex: number;
  posX: number;
  posY: number;
  posZ: number;
  stepSurfaceY: number;
  cushionSurfaceY: number;
  backrestTopY: number;
  eyePosY: number;
  rotY: number;
  baseRotY: number;
  yawJitterDeg: number;
  heightJitterM: number;
  wearFactor: number;
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

export interface DeterministicSeatInventoryItem {
  seatId: number;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED';
  holdUserId?: number | null;
  holdToken?: string | null;
  holdExpiresAt?: string | null;
}

export interface DeterministicMatchPricingItem {
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  colorHex: string;
  basePricePaise: number;
  dynamicMultiplier: number;
  finalPricePaise: number;
  isCovered: boolean;
}

export interface DeterministicMatchSummary {
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
  pricing: DeterministicMatchPricingItem[];
  inventorySummary: {
    total: number;
    available: number;
    held: number;
    booked: number;
    blocked: number;
    occupancyPct: number;
  };
}

export interface DeterministicStaticStadiumBundle {
  stadium: {
    id: number;
    code: string;
    name: string;
    city: string;
    country: string;
    capacity: number;
    spec: StadiumSpec;
  };
  categories: Array<{
    id: number;
    stadiumId: number;
    code: string;
    name: string;
    colorHex: string;
    basePricePaise: number;
    isCovered: boolean;
    tierLevel: number;
  }>;
  stands: Array<{
    id: number;
    stadiumId: number;
    code: string;
    name: string;
    orientationAngleDeg: number;
    tierCount: number;
  }>;
  blocks: Array<{
    id: number;
    stadiumId: number;
    standId: number;
    categoryId: number;
    code: string;
    name: string;
    tier: number;
    rowCount: number;
    seatsPerRow: number;
    elevationBaseM: number;
    radialOffsetM: number;
  }>;
  seats: DeterministicStaticSeatRecord[];
  defaultMatches: DeterministicMatchSummary[];
  getMatchInventorySnapshot: (matchId: number) => {
    matchId: number;
    inventory: DeterministicSeatInventoryItem[];
    pricing: DeterministicMatchPricingItem[];
  };
}

let cachedDefaultBundle: DeterministicStaticStadiumBundle | null = null;

/**
 * Builds the exact deterministic 4,800-anchor / 33,600-instance stadium bundle
 * from DEFAULT_STADIUM_SPEC without requiring PostgreSQL connectivity.
 * Preserves 1:1 parity with seeded Cloud SQL records and seat coordinates.
 */
export function buildDeterministicStaticStadiumBundle(
  spec: StadiumSpec = DEFAULT_STADIUM_SPEC
): DeterministicStaticStadiumBundle {
  if (spec === DEFAULT_STADIUM_SPEC && cachedDefaultBundle) {
    return cachedDefaultBundle;
  }

  const stadiumId = 1;
  const generatedSeats = generateSeatsFromSpec(spec);

  const categories = spec.categories.map((c, idx) => ({
    id: idx + 1,
    stadiumId,
    code: c.code,
    name: c.name,
    colorHex: c.colorHex,
    basePricePaise: c.basePricePaise,
    isCovered: c.isCovered,
    tierLevel: c.tierLevel,
  }));
  const categoryByCode = new Map(categories.map((c) => [c.code, c]));
  const categorySpecByCode = new Map(spec.categories.map((c) => [c.code, c]));

  const stands: DeterministicStaticStadiumBundle['stands'] = [];
  const blocks: DeterministicStaticStadiumBundle['blocks'] = [];
  const standByCode = new Map<string, DeterministicStaticStadiumBundle['stands'][number]>();
  const blockByCode = new Map<string, DeterministicStaticStadiumBundle['blocks'][number]>();

  spec.stands.forEach((st, sIdx) => {
    const standRow = {
      id: sIdx + 1,
      stadiumId,
      code: st.code,
      name: st.name,
      orientationAngleDeg: st.orientationAngleDeg,
      tierCount: st.blocks.length,
    };
    stands.push(standRow);
    standByCode.set(st.code, standRow);

    st.blocks.forEach((bl) => {
      const cat = categoryByCode.get(bl.categoryCode)!;
      const blockRow = {
        id: blocks.length + 1,
        stadiumId,
        standId: standRow.id,
        categoryId: cat.id,
        code: bl.code,
        name: bl.name,
        tier: bl.tier,
        rowCount: bl.rowCount,
        seatsPerRow: bl.seatsPerRow,
        elevationBaseM: bl.elevationBaseM,
        radialOffsetM: bl.radialOffsetM,
      };
      blocks.push(blockRow);
      blockByCode.set(bl.code, blockRow);
    });
  });

  const seats: DeterministicStaticSeatRecord[] = generatedSeats.map((gs) => {
    const st = standByCode.get(gs.standCode)!;
    const bl = blockByCode.get(gs.blockCode)!;
    const cat = categoryByCode.get(gs.categoryCode)!;
    const catSpec = categorySpecByCode.get(gs.categoryCode);
    return {
      id: gs.instanceIndex + 1,
      seatCode: gs.seatCode,
      standId: st.id,
      standCode: gs.standCode,
      standName: gs.standName,
      blockId: bl.id,
      blockCode: gs.blockCode,
      blockName: gs.blockName,
      categoryId: cat.id,
      categoryCode: gs.categoryCode,
      categoryName: cat.name,
      colorHex: cat.colorHex,
      seatPlasticHex: catSpec?.seatPlasticHex || '#0284C7',
      isCovered: cat.isCovered,
      tier: gs.tier,
      rowNumber: gs.rowNumber,
      seatNumber: gs.seatNumber,
      instanceIndex: gs.instanceIndex,
      posX: gs.posX,
      posY: gs.posY,
      posZ: gs.posZ,
      stepSurfaceY: gs.stepSurfaceY,
      cushionSurfaceY: gs.cushionSurfaceY,
      backrestTopY: gs.backrestTopY,
      eyePosY: gs.eyePosY,
      rotY: gs.rotY,
      baseRotY: gs.baseRotY,
      yawJitterDeg: gs.yawJitterDeg,
      heightJitterM: gs.heightJitterM,
      wearFactor: gs.wearFactor,
      colorVariationSeed: gs.colorVariationSeed,
      distanceToPitchM: gs.distanceToPitchM,
      distanceToBoundaryM: gs.distanceToBoundaryM,
      elevationAngleDeg: gs.elevationAngleDeg,
      horizontalAngleDeg: gs.horizontalAngleDeg,
      scoreboardVisible: gs.scoreboardVisible,
      obstructionWarning: gs.obstructionWarning,
      shadeAfternoonPct: gs.shadeAfternoonPct,
      viewQualityScore: gs.viewQualityScore,
    };
  });

  const matchDefs = [
    {
      id: 1,
      daysOffset: 5,
      tournament: 'ICC Champions Trophy — Grand Final',
      title: 'India vs Australia — Day/Night Championship Final',
      demandMultiplier: 1.15,
      rivalryMultiplier: 1.25,
      weekendMultiplier: 1.1,
      homeTeam: {
        code: 'IND',
        name: 'India National Cricket Team',
        shortName: 'IND',
        primaryColor: '#0284C7',
        secondaryColor: '#F97316',
      },
      awayTeam: {
        code: 'AUS',
        name: 'Australia Cricket Team',
        shortName: 'AUS',
        primaryColor: '#EAB308',
        secondaryColor: '#15803D',
      },
    },
    {
      id: 2,
      daysOffset: 9,
      tournament: 'Indian Premier T20 League — Qualifier 1',
      title: 'Mumbai vs Chennai — Floodlit T20 Blockbuster',
      demandMultiplier: 1.2,
      rivalryMultiplier: 1.3,
      weekendMultiplier: 1.1,
      homeTeam: {
        code: 'MI',
        name: 'Mumbai Royals XI',
        shortName: 'MUM',
        primaryColor: '#2563EB',
        secondaryColor: '#F59E0B',
      },
      awayTeam: {
        code: 'CSK',
        name: 'Chennai Super Kings XI',
        shortName: 'CHE',
        primaryColor: '#FACC15',
        secondaryColor: '#1D4ED8',
      },
    },
    {
      id: 3,
      daysOffset: 14,
      tournament: 'Bilateral Test Series — 1st Test',
      title: 'India vs England — Morning Red-Ball Classic',
      demandMultiplier: 1.0,
      rivalryMultiplier: 1.1,
      weekendMultiplier: 1.0,
      homeTeam: {
        code: 'IND',
        name: 'India National Cricket Team',
        shortName: 'IND',
        primaryColor: '#0284C7',
        secondaryColor: '#F97316',
      },
      awayTeam: {
        code: 'ENG',
        name: 'England Cricket Team',
        shortName: 'ENG',
        primaryColor: '#1D4ED8',
        secondaryColor: '#DC2626',
      },
    },
  ];

  const baseNow = Date.now();
  const pricingByMatchId = new Map<number, DeterministicMatchPricingItem[]>();
  const inventoryByMatchId = new Map<number, DeterministicSeatInventoryItem[]>();

  const defaultMatches: DeterministicMatchSummary[] = matchDefs.map((def, mIdx) => {
    const pricing: DeterministicMatchPricingItem[] = categories.map((cat) => {
      const { combinedMultiplier, finalPricePaise } = computeDynamicPricePaise(
        cat.basePricePaise,
        {
          demand: def.demandMultiplier,
          rivalry: def.rivalryMultiplier,
          weekend: def.weekendMultiplier,
        }
      );
      return {
        categoryId: cat.id,
        categoryCode: cat.code,
        categoryName: cat.name,
        colorHex: cat.colorHex,
        basePricePaise: cat.basePricePaise,
        dynamicMultiplier: combinedMultiplier,
        finalPricePaise,
        isCovered: cat.isCovered,
      };
    });

    let available = 0;
    let booked = 0;
    let blocked = 0;
    const inventory: DeterministicSeatInventoryItem[] = seats.map((sr) => {
      const isBlockedCamera =
        sr.rowNumber === 10 &&
        (sr.seatNumber === 10 || sr.seatNumber === 11) &&
        (sr.seatCode.startsWith('N-T1') || sr.seatCode.startsWith('S-T1'));
      const isDemoTicket =
        mIdx === 0 && (sr.seatCode === 'N-T2-R02-S09' || sr.seatCode === 'N-T2-R02-S10');
      const isPreBooked =
        !isBlockedCamera &&
        ((sr.instanceIndex * 17 + mIdx * 31) % 11 === 0) &&
        sr.seatCode !== 'N-T2-R03-S08' &&
        sr.seatCode !== 'N-T2-R03-S09';

      const status: DeterministicSeatInventoryItem['status'] = isBlockedCamera
        ? 'BLOCKED'
        : isPreBooked || isDemoTicket
        ? 'BOOKED'
        : 'AVAILABLE';

      if (status === 'BLOCKED') blocked++;
      else if (status === 'BOOKED') booked++;
      else available++;

      return {
        seatId: sr.id,
        status,
        holdUserId: null,
        holdToken: null,
        holdExpiresAt: null,
      };
    });

    pricingByMatchId.set(def.id, pricing);
    inventoryByMatchId.set(def.id, inventory);

    return {
      id: def.id,
      stadiumId,
      tournament: def.tournament,
      title: def.title,
      startTime: new Date(baseNow + def.daysOffset * 24 * 3600 * 1000).toISOString(),
      status: 'UPCOMING',
      demandMultiplier: def.demandMultiplier,
      rivalryMultiplier: def.rivalryMultiplier,
      weekendMultiplier: def.weekendMultiplier,
      homeTeam: def.homeTeam,
      awayTeam: def.awayTeam,
      pricing,
      inventorySummary: {
        total: inventory.length,
        available,
        held: 0,
        booked,
        blocked,
        occupancyPct: inventory.length > 0 ? Math.round((booked / inventory.length) * 100) : 0,
      },
    };
  });

  const bundle: DeterministicStaticStadiumBundle = {
    stadium: {
      id: stadiumId,
      code: spec.code,
      name: spec.name,
      city: spec.city,
      country: spec.country,
      capacity: seats.length,
      spec,
    },
    categories,
    stands,
    blocks,
    seats,
    defaultMatches,
    getMatchInventorySnapshot: (matchId: number) => ({
      matchId,
      inventory: inventoryByMatchId.get(matchId) ?? inventoryByMatchId.get(1) ?? [],
      pricing: pricingByMatchId.get(matchId) ?? pricingByMatchId.get(1) ?? [],
    }),
  };

  if (spec === DEFAULT_STADIUM_SPEC) {
    cachedDefaultBundle = bundle;
  }

  return bundle;
}
