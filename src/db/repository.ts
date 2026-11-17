import crypto from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  blocks,
  bookingSeats,
  bookings,
  matchSeatPricing,
  matches,
  payments,
  scanLogs,
  seatCategories,
  seatInventory,
  seats,
  stadiums,
  stands,
  teams,
  tickets,
  users,
} from './schema.ts';
import {
  DEFAULT_STADIUM_SPEC,
  computeDynamicPricePaise,
  generateSeatsFromSpec,
} from '../shared/stadiumSpec.ts';
import {
  calculateRefundPaise,
  signQrTicketToken,
  verifyQrTicketToken,
  verifyRazorpaySignature,
} from '../shared/security.ts';
import { holdLockBroker } from '../server/holdLockBroker.ts';

let seedPromise: Promise<void> | null = null;
let cachedStaticSeats: Array<{
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
}> | null = null;

export async function getOrCreateUser(
  uid: string,
  email: string,
  name = 'Cricket Fan',
  role: 'USER' | 'ADMIN' | 'GATE_STAFF' = 'USER'
) {
  try {
    const result = await db
      .insert(users)
      .values({
        uid,
        email,
        name,
        role,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email,
          name,
          role,
        },
      })
      .returning();
    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

/**
 * Lazily seeds the full 4,800-seat stadium, stands, blocks, categories, teams, matches,
 * inventory, and sample confirmed booking if not already present in Cloud SQL.
 */
export async function ensureStadiumSeeded(): Promise<void> {
  if (seedPromise) {
    return seedPromise;
  }

  seedPromise = (async () => {
    try {
      const existingStadium = await db
        .select()
        .from(stadiums)
        .where(eq(stadiums.code, DEFAULT_STADIUM_SPEC.code));

      if (existingStadium.length > 0) {
        const s1Seats = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);
        const [firstDbSeat] = await db
          .select()
          .from(seats)
          .where(eq(seats.seatCode, s1Seats[0].seatCode))
          .limit(1);

        const needsSync =
          !firstDbSeat ||
          Math.hypot(
            firstDbSeat.posX - s1Seats[0].posX,
            firstDbSeat.posY - s1Seats[0].posY,
            firstDbSeat.posZ - s1Seats[0].posZ
          ) > 0.0005;

        if (needsSync) {
          console.log('Synchronizing PostgreSQL 4,800 seat transforms with S1 real-world dimensions...');
          await db
            .update(stadiums)
            .set({ specJson: JSON.stringify(DEFAULT_STADIUM_SPEC) })
            .where(eq(stadiums.id, existingStadium[0].id));

          for (const catSpec of DEFAULT_STADIUM_SPEC.categories) {
            await db
              .update(seatCategories)
              .set({ colorHex: catSpec.colorHex })
              .where(
                and(
                  eq(seatCategories.stadiumId, existingStadium[0].id),
                  eq(seatCategories.code, catSpec.code)
                )
              );
          }

          const BATCH_SIZE = 400;
          for (let i = 0; i < s1Seats.length; i += BATCH_SIZE) {
            const slice = s1Seats.slice(i, i + BATCH_SIZE);
            const valuesTupleSql = slice
              .map(
                (gs) =>
                  `('${gs.seatCode}', ${gs.posX}::double precision, ${gs.posY}::double precision, ${gs.posZ}::double precision, ${gs.rotY}::double precision, ${gs.distanceToPitchM}::double precision, ${gs.distanceToBoundaryM}::double precision, ${gs.elevationAngleDeg}::double precision, ${gs.horizontalAngleDeg}::double precision, ${gs.scoreboardVisible}::boolean, '${gs.obstructionWarning.replace(/'/g, "''")}', ${gs.shadeAfternoonPct}::integer, ${gs.viewQualityScore}::integer)`
              )
              .join(', ');

            await db.execute(
              sql.raw(`
                UPDATE seats AS s
                SET
                  pos_x = v.pos_x,
                  pos_y = v.pos_y,
                  pos_z = v.pos_z,
                  rot_y = v.rot_y,
                  distance_to_pitch_m = v.distance_to_pitch_m,
                  distance_to_boundary_m = v.distance_to_boundary_m,
                  elevation_angle_deg = v.elevation_angle_deg,
                  horizontal_angle_deg = v.horizontal_angle_deg,
                  scoreboard_visible = v.scoreboard_visible,
                  obstruction_warning = v.obstruction_warning,
                  shade_afternoon_pct = v.shade_afternoon_pct,
                  view_quality_score = v.view_quality_score
                FROM (VALUES ${valuesTupleSql}) AS v(
                  seat_code, pos_x, pos_y, pos_z, rot_y,
                  distance_to_pitch_m, distance_to_boundary_m,
                  elevation_angle_deg, horizontal_angle_deg,
                  scoreboard_visible, obstruction_warning,
                  shade_afternoon_pct, view_quality_score
                )
                WHERE s.seat_code = v.seat_code
              `)
            );
          }
          cachedStaticSeats = null;
          console.log('PostgreSQL 4,800 seat S1 transforms synchronized to 0.0000m parity.');
        }
        return;
      }

      console.log('Seeding STADIUMX 4,800-seat parametric stadium and matches into Cloud SQL...');

      // 1. Seed default users
      const fanUser = await getOrCreateUser(
        'demo-fan-uid',
        'fan@stadiumx.in',
        'Aarav Mehta',
        'USER'
      );
      const adminUser = await getOrCreateUser(
        'demo-admin-uid',
        'admin@stadiumx.in',
        'Vikram Rathore (Venue Director)',
        'ADMIN'
      );
      await getOrCreateUser(
        'demo-gate-uid',
        'gate@stadiumx.in',
        'Suresh Nair (Gate 1 Turnstile)',
        'GATE_STAFF'
      );

      // 2. Insert Stadium
      const generatedSeats = generateSeatsFromSpec(DEFAULT_STADIUM_SPEC);
      const [stadium] = await db
        .insert(stadiums)
        .values({
          code: DEFAULT_STADIUM_SPEC.code,
          name: DEFAULT_STADIUM_SPEC.name,
          city: DEFAULT_STADIUM_SPEC.city,
          country: DEFAULT_STADIUM_SPEC.country,
          capacity: generatedSeats.length,
          specJson: JSON.stringify(DEFAULT_STADIUM_SPEC),
        })
        .onConflictDoNothing()
        .returning();

      if (!stadium) return;

      // 3. Insert Seat Categories
      const insertedCategories = await db
        .insert(seatCategories)
        .values(
          DEFAULT_STADIUM_SPEC.categories.map((c) => ({
            stadiumId: stadium.id,
            code: c.code,
            name: c.name,
            colorHex: c.colorHex,
            basePricePaise: c.basePricePaise,
            isCovered: c.isCovered,
            tierLevel: c.tierLevel,
          }))
        )
        .returning();

      const categoryMap = new Map(insertedCategories.map((c) => [c.code, c]));

      // 4. Insert Stands & Blocks
      const standMap = new Map<string, typeof stands.$inferSelect>();
      const blockMap = new Map<string, typeof blocks.$inferSelect>();

      for (const st of DEFAULT_STADIUM_SPEC.stands) {
        const [insertedStand] = await db
          .insert(stands)
          .values({
            stadiumId: stadium.id,
            code: st.code,
            name: st.name,
            orientationAngleDeg: st.orientationAngleDeg,
            tierCount: st.blocks.length,
          })
          .returning();
        standMap.set(st.code, insertedStand);

        for (const bl of st.blocks) {
          const [insertedBlock] = await db
            .insert(blocks)
            .values({
              stadiumId: stadium.id,
              standId: insertedStand.id,
              code: bl.code,
              name: bl.name,
              tier: bl.tier,
              rowCount: bl.rowCount,
              seatsPerRow: bl.seatsPerRow,
              elevationBaseM: bl.elevationBaseM,
              rakeAngleDeg: bl.rakeAngleDeg,
            })
            .returning();
          blockMap.set(bl.code, insertedBlock);
        }
      }

      // 5. Batch insert all 4,800 seats
      const insertedSeatRows: Array<{
        id: number;
        seatCode: string;
        blockId: number;
        categoryId: number;
        instanceIndex: number;
        rowNumber: number;
        seatNumber: number;
      }> = [];

      const BATCH_SIZE = 600;
      for (let i = 0; i < generatedSeats.length; i += BATCH_SIZE) {
        const chunk = generatedSeats.slice(i, i + BATCH_SIZE);
        const batchValues = chunk.map((gs) => {
          const st = standMap.get(gs.standCode)!;
          const bl = blockMap.get(gs.blockCode)!;
          const cat = categoryMap.get(gs.categoryCode)!;
          return {
            stadiumId: stadium.id,
            standId: st.id,
            blockId: bl.id,
            categoryId: cat.id,
            seatCode: gs.seatCode,
            rowNumber: gs.rowNumber,
            seatNumber: gs.seatNumber,
            instanceIndex: gs.instanceIndex,
            posX: gs.posX,
            posY: gs.posY,
            posZ: gs.posZ,
            rotY: gs.rotY,
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

        const res = await db
          .insert(seats)
          .values(batchValues)
          .returning({
            id: seats.id,
            seatCode: seats.seatCode,
            blockId: seats.blockId,
            categoryId: seats.categoryId,
            instanceIndex: seats.instanceIndex,
            rowNumber: seats.rowNumber,
            seatNumber: seats.seatNumber,
          });
        insertedSeatRows.push(...res);
      }

      // 6. Seed Teams
      const insertedTeams = await db
        .insert(teams)
        .values([
          {
            code: 'IND',
            name: 'India National Cricket Team',
            shortName: 'IND',
            primaryColor: '#0284C7',
            secondaryColor: '#F97316',
          },
          {
            code: 'AUS',
            name: 'Australia Cricket Team',
            shortName: 'AUS',
            primaryColor: '#EAB308',
            secondaryColor: '#15803D',
          },
          {
            code: 'ENG',
            name: 'England Cricket Team',
            shortName: 'ENG',
            primaryColor: '#1D4ED8',
            secondaryColor: '#DC2626',
          },
          {
            code: 'MI',
            name: 'Mumbai Royals XI',
            shortName: 'MUM',
            primaryColor: '#2563EB',
            secondaryColor: '#F59E0B',
          },
          {
            code: 'CSK',
            name: 'Chennai Super Kings XI',
            shortName: 'CHE',
            primaryColor: '#FACC15',
            secondaryColor: '#1D4ED8',
          },
        ])
        .returning();

      const teamByCode = new Map(insertedTeams.map((t) => [t.code, t]));

      // 7. Seed 3 Matches
      const now = Date.now();
      const insertedMatches = await db
        .insert(matches)
        .values([
          {
            stadiumId: stadium.id,
            homeTeamId: teamByCode.get('IND')!.id,
            awayTeamId: teamByCode.get('AUS')!.id,
            tournament: 'ICC Champions Trophy — Grand Final',
            title: 'India vs Australia — Day/Night Championship Final',
            startTime: new Date(now + 5 * 24 * 3600 * 1000),
            status: 'UPCOMING',
            demandMultiplier: 1.15,
            rivalryMultiplier: 1.25,
            weekendMultiplier: 1.1,
            refundPolicyJson: JSON.stringify({ fullRefundHoursBefore: 48, partialRefundPct: 70 }),
          },
          {
            stadiumId: stadium.id,
            homeTeamId: teamByCode.get('MI')!.id,
            awayTeamId: teamByCode.get('CSK')!.id,
            tournament: 'Indian Premier T20 League — Qualifier 1',
            title: 'Mumbai vs Chennai — Floodlit T20 Blockbuster',
            startTime: new Date(now + 9 * 24 * 3600 * 1000),
            status: 'UPCOMING',
            demandMultiplier: 1.2,
            rivalryMultiplier: 1.3,
            weekendMultiplier: 1.1,
            refundPolicyJson: JSON.stringify({ fullRefundHoursBefore: 48, partialRefundPct: 65 }),
          },
          {
            stadiumId: stadium.id,
            homeTeamId: teamByCode.get('IND')!.id,
            awayTeamId: teamByCode.get('ENG')!.id,
            tournament: 'Bilateral Test Series — 1st Test',
            title: 'India vs England — Morning Red-Ball Classic',
            startTime: new Date(now + 14 * 24 * 3600 * 1000),
            status: 'UPCOMING',
            demandMultiplier: 1.0,
            rivalryMultiplier: 1.1,
            weekendMultiplier: 1.0,
            refundPolicyJson: JSON.stringify({ fullRefundHoursBefore: 24, partialRefundPct: 80 }),
          },
        ])
        .returning();

      // 8. Seed Match Seat Pricing & Seat Inventory for each match
      for (let mIdx = 0; mIdx < insertedMatches.length; mIdx++) {
        const match = insertedMatches[mIdx];
        const pricingRows = insertedCategories.map((cat) => {
          const { combinedMultiplier, finalPricePaise } = computeDynamicPricePaise(
            cat.basePricePaise,
            {
              demand: match.demandMultiplier,
              rivalry: match.rivalryMultiplier,
              weekend: match.weekendMultiplier,
            }
          );
          return {
            matchId: match.id,
            categoryId: cat.id,
            basePricePaise: cat.basePricePaise,
            dynamicMultiplier: combinedMultiplier,
            finalPricePaise,
          };
        });
        await db.insert(matchSeatPricing).values(pricingRows);

        // Create inventory rows in batches of 800
        const INV_BATCH = 800;
        for (let i = 0; i < insertedSeatRows.length; i += INV_BATCH) {
          const slice = insertedSeatRows.slice(i, i + INV_BATCH);
          const invValues = slice.map((sr) => {
            // Deterministic realistic pattern: camera platforms at row 10 seat 10-11 in North/South Tier 1 are BLOCKED
            const isBlockedCamera =
              sr.rowNumber === 10 &&
              (sr.seatNumber === 10 || sr.seatNumber === 11) &&
              (sr.seatCode.startsWith('N-T1') || sr.seatCode.startsWith('S-T1'));
            // Pre-book ~9% of seats deterministically so analytics and 3D seat bowl look realistic
            const isPreBooked =
              !isBlockedCamera &&
              ((sr.instanceIndex * 17 + mIdx * 31) % 11 === 0) &&
              sr.seatCode !== 'N-T2-R03-S08' &&
              sr.seatCode !== 'N-T2-R03-S09';

            return {
              matchId: match.id,
              seatId: sr.id,
              blockId: sr.blockId,
              status: isBlockedCamera
                ? 'BLOCKED'
                : isPreBooked
                ? 'BOOKED'
                : 'AVAILABLE',
              viewCount: (sr.instanceIndex % 7) + (sr.seatCode.startsWith('N-T2') ? 19 : 1),
            };
          });
          await db.insert(seatInventory).values(invValues);
        }
      }

      // 9. Create a confirmed sample booking & signed QR ticket for Aarav Mehta on Match 1
      const primaryMatch = insertedMatches[0];
      const demoSeats = insertedSeatRows.filter(
        (s) => s.seatCode === 'N-T2-R02-S09' || s.seatCode === 'N-T2-R02-S10'
      );
      if (demoSeats.length === 2) {
        const vipCategory = categoryMap.get('VIP_LOUNGE')!;
        const { finalPricePaise } = computeDynamicPricePaise(vipCategory.basePricePaise, {
          demand: primaryMatch.demandMultiplier,
          rivalry: primaryMatch.rivalryMultiplier,
          weekend: primaryMatch.weekendMultiplier,
        });
        const totalAmountPaise = finalPricePaise * demoSeats.length;

        const [sampleBooking] = await db
          .insert(bookings)
          .values({
            bookingReference: 'BK-STX-202601',
            userId: fanUser.id,
            matchId: primaryMatch.id,
            status: 'CONFIRMED',
            totalAmountPaise,
            seatCount: demoSeats.length,
            holdToken: 'HOLD-SEED-INITIAL',
            expiresAt: new Date(now + 3600_000),
          })
          .returning();

        for (const ds of demoSeats) {
          await db.insert(bookingSeats).values({
            bookingId: sampleBooking.id,
            matchId: primaryMatch.id,
            seatId: ds.id,
            pricePaise: finalPricePaise,
          });

          await db
            .update(seatInventory)
            .set({
              status: 'BOOKED',
              bookingId: sampleBooking.id,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(seatInventory.matchId, primaryMatch.id),
                eq(seatInventory.seatId, ds.id)
              )
            );

          const ticketCode = `TKT-STX-${ds.seatCode}`;
          const qrSignedToken = signQrTicketToken({
            ticketCode,
            bookingReference: sampleBooking.bookingReference,
            matchId: primaryMatch.id,
            seatId: ds.id,
            seatCode: ds.seatCode,
            userId: fanUser.id,
            issuedAt: now,
            expiresAt: now + 30 * 24 * 3600 * 1000,
          });

          await db.insert(tickets).values({
            ticketCode,
            bookingId: sampleBooking.id,
            matchId: primaryMatch.id,
            seatId: ds.id,
            userId: fanUser.id,
            qrSignedToken,
            status: 'VALID',
          });
        }

        await db.insert(payments).values({
          bookingId: sampleBooking.id,
          razorpayOrderId: 'order_test_seed_202601',
          razorpayPaymentId: 'pay_test_seed_202601',
          razorpaySignature: 'verified_seed_signature',
          idempotencyKey: 'idem_seed_202601',
          amountPaise: totalAmountPaise,
          currency: 'INR',
          status: 'CAPTURED',
        });

        await db.insert(auditLogs).values({
          actorUserId: adminUser.id,
          actorRole: 'ADMIN',
          action: 'STADIUM_INITIALIZED',
          entityType: 'STADIUM',
          entityId: String(stadium.id),
          metadataJson: JSON.stringify({
            seatsGenerated: generatedSeats.length,
            matchesCreated: insertedMatches.length,
          }),
        });
      }

      console.log('STADIUMX Cloud SQL seeding completed successfully.');
    } catch (error) {
      seedPromise = null;
      console.error('Error seeding STADIUMX database:', error);
      throw new Error('Failed to seed initial stadium data.', { cause: error });
    }
  })();

  return seedPromise;
}

export async function getStadiumBundle() {
  try {
    await ensureStadiumSeeded();
    const [stadium] = await db.select().from(stadiums).limit(1);
    const categoriesList = await db
      .select()
      .from(seatCategories)
      .where(eq(seatCategories.stadiumId, stadium.id));
    const standsList = await db
      .select()
      .from(stands)
      .where(eq(stands.stadiumId, stadium.id));
    const blocksList = await db
      .select()
      .from(blocks)
      .where(eq(blocks.stadiumId, stadium.id));

    return {
      stadium: {
        ...stadium,
        spec: JSON.parse(stadium.specJson),
      },
      categories: categoriesList,
      stands: standsList,
      blocks: blocksList,
    };
  } catch (error) {
    console.error('Failed to load stadium bundle:', error);
    throw new Error('Failed to load stadium specification.', { cause: error });
  }
}

export async function getStaticStadiumSeats() {
  try {
    await ensureStadiumSeeded();
    if (cachedStaticSeats) {
      return cachedStaticSeats;
    }

    const [stadium] = await db.select().from(stadiums).limit(1);
    const cats = await db
      .select()
      .from(seatCategories)
      .where(eq(seatCategories.stadiumId, stadium.id));
    const standsList = await db
      .select()
      .from(stands)
      .where(eq(stands.stadiumId, stadium.id));
    const blocksList = await db
      .select()
      .from(blocks)
      .where(eq(blocks.stadiumId, stadium.id));
    const allSeats = await db
      .select()
      .from(seats)
      .where(eq(seats.stadiumId, stadium.id))
      .orderBy(asc(seats.instanceIndex));

    const catById = new Map(cats.map((c) => [c.id, c]));
    const standById = new Map(standsList.map((s) => [s.id, s]));
    const blockById = new Map(blocksList.map((b) => [b.id, b]));
    const specGeneratedByCode = new Map(
      generateSeatsFromSpec(DEFAULT_STADIUM_SPEC).map((gs) => [gs.seatCode, gs])
    );
    const catSpecByCode = new Map(
      DEFAULT_STADIUM_SPEC.categories.map((cs) => [cs.code, cs])
    );

    cachedStaticSeats = allSeats.map((s) => {
      const cat = catById.get(s.categoryId)!;
      const st = standById.get(s.standId)!;
      const bl = blockById.get(s.blockId)!;
      const gs = specGeneratedByCode.get(s.seatCode);
      const cs = catSpecByCode.get(cat.code as any);
      return {
        id: s.id,
        seatCode: s.seatCode,
        standId: s.standId,
        standCode: st.code,
        standName: st.name,
        blockId: s.blockId,
        blockCode: bl.code,
        blockName: bl.name,
        categoryId: s.categoryId,
        categoryCode: cat.code,
        categoryName: cat.name,
        colorHex: cat.colorHex,
        seatPlasticHex: cs?.seatPlasticHex || '#0284C7',
        isCovered: cat.isCovered,
        tier: bl.tier,
        rowNumber: s.rowNumber,
        seatNumber: s.seatNumber,
        instanceIndex: s.instanceIndex,
        posX: s.posX,
        posY: s.posY,
        posZ: s.posZ,
        stepSurfaceY: gs ? gs.stepSurfaceY : Number(s.posY.toFixed(4)),
        cushionSurfaceY: gs ? gs.cushionSurfaceY : Number((s.posY + 0.42).toFixed(4)),
        backrestTopY: gs ? gs.backrestTopY : Number((s.posY + 0.85).toFixed(4)),
        eyePosY: gs ? gs.eyePosY : Number((s.posY + 1.15).toFixed(4)),
        rotY: s.rotY,
        baseRotY: gs ? gs.baseRotY : s.rotY,
        yawJitterDeg: gs ? gs.yawJitterDeg : 0,
        heightJitterM: gs ? gs.heightJitterM : 0,
        wearFactor: gs ? gs.wearFactor : 0.12,
        colorVariationSeed: gs ? gs.colorVariationSeed : 0.5,
        distanceToPitchM: s.distanceToPitchM,
        distanceToBoundaryM: s.distanceToBoundaryM,
        elevationAngleDeg: s.elevationAngleDeg,
        horizontalAngleDeg: s.horizontalAngleDeg,
        scoreboardVisible: s.scoreboardVisible,
        obstructionWarning: s.obstructionWarning,
        shadeAfternoonPct: s.shadeAfternoonPct,
        viewQualityScore: s.viewQualityScore,
      };
    });

    return cachedStaticSeats;
  } catch (error) {
    console.error('Failed to query static stadium seats:', error);
    throw new Error('Failed to load stadium seats.', { cause: error });
  }
}

export async function listMatchesWithStats() {
  try {
    await ensureStadiumSeeded();
    const allMatches = await db.select().from(matches).orderBy(asc(matches.startTime));
    const allTeams = await db.select().from(teams);
    const allPricing = await db.select().from(matchSeatPricing);
    const allCats = await db.select().from(seatCategories);

    const teamMap = new Map(allTeams.map((t) => [t.id, t]));
    const catMap = new Map(allCats.map((c) => [c.id, c]));

    const result = [];
    for (const m of allMatches) {
      const invRows = await db
        .select({
          status: seatInventory.status,
        })
        .from(seatInventory)
        .where(eq(seatInventory.matchId, m.id));

      let available = 0;
      let held = 0;
      let booked = 0;
      let blocked = 0;
      for (const r of invRows) {
        if (r.status === 'AVAILABLE') available++;
        else if (r.status === 'HELD') held++;
        else if (r.status === 'BOOKED') booked++;
        else if (r.status === 'BLOCKED') blocked++;
      }

      const matchPricing = allPricing
        .filter((p) => p.matchId === m.id)
        .map((p) => {
          const cat = catMap.get(p.categoryId);
          return {
            ...p,
            categoryCode: cat?.code || '',
            categoryName: cat?.name || '',
            colorHex: cat?.colorHex || '#10B981',
            isCovered: cat?.isCovered ?? true,
          };
        });

      result.push({
        ...m,
        homeTeam: teamMap.get(m.homeTeamId),
        awayTeam: teamMap.get(m.awayTeamId),
        pricing: matchPricing,
        inventorySummary: {
          total: invRows.length,
          available,
          held,
          booked,
          blocked,
          occupancyPct: invRows.length > 0 ? Math.round((booked / invRows.length) * 100) : 0,
        },
      });
    }

    return result;
  } catch (error) {
    console.error('Failed to list matches:', error);
    throw new Error('Failed to load match schedule.', { cause: error });
  }
}

/**
 * Releases any expired HELD seats back to AVAILABLE and returns the released rows for socket broadcast.
 */
export async function sweepExpiredHolds(): Promise<
  Array<{ matchId: number; seatIds: number[]; instanceIndices: number[] }>
> {
  try {
    const now = new Date();
    const expiredRows = await db
      .select()
      .from(seatInventory)
      .where(and(eq(seatInventory.status, 'HELD'), lt(seatInventory.holdExpiresAt, now)));

    if (expiredRows.length === 0) return [];

    const staticSeats = await getStaticStadiumSeats();
    const instanceBySeatId = new Map(staticSeats.map((s) => [s.id, s.instanceIndex]));

    const groupedByMatch = new Map<number, number[]>();
    for (const row of expiredRows) {
      const list = groupedByMatch.get(row.matchId) ?? [];
      list.push(row.seatId);
      groupedByMatch.set(row.matchId, list);
      if (row.holdToken) {
        holdLockBroker.removeHold(row.holdToken);
      }
    }

    const updates: Array<{ matchId: number; seatIds: number[]; instanceIndices: number[] }> = [];
    for (const [matchId, seatIds] of groupedByMatch) {
      await db
        .update(seatInventory)
        .set({
          status: 'AVAILABLE',
          holdUserId: null,
          holdToken: null,
          holdExpiresAt: null,
          updatedAt: now,
        })
        .where(and(eq(seatInventory.matchId, matchId), inArray(seatInventory.seatId, seatIds)));

      updates.push({
        matchId,
        seatIds,
        instanceIndices: seatIds.map((id) => instanceBySeatId.get(id) ?? 0),
      });
    }

    return updates;
  } catch (error) {
    console.error('Error sweeping expired holds:', error);
    return [];
  }
}

export async function getMatchInventorySnapshot(matchId: number) {
  try {
    await ensureStadiumSeeded();
    await sweepExpiredHolds();

    const inv = await db
      .select({
        seatId: seatInventory.seatId,
        status: seatInventory.status,
        holdUserId: seatInventory.holdUserId,
        holdToken: seatInventory.holdToken,
        holdExpiresAt: seatInventory.holdExpiresAt,
      })
      .from(seatInventory)
      .where(eq(seatInventory.matchId, matchId));

    const pricing = await db
      .select()
      .from(matchSeatPricing)
      .where(eq(matchSeatPricing.matchId, matchId));

    return {
      matchId,
      inventory: inv,
      pricing,
    };
  } catch (error) {
    console.error('Failed to get match inventory:', error);
    throw new Error('Failed to load live seat inventory.', { cause: error });
  }
}

export async function incrementSeatViewCount(matchId: number, seatId: number) {
  try {
    const existing = await db
      .select()
      .from(seatInventory)
      .where(and(eq(seatInventory.matchId, matchId), eq(seatInventory.seatId, seatId)));
    if (existing.length > 0) {
      await db
        .update(seatInventory)
        .set({ viewCount: existing[0].viewCount + 1 })
        .where(eq(seatInventory.id, existing[0].id));
    }
  } catch (error) {
    console.error('Failed to increment seat view count:', error);
  }
}

/**
 * Atomically places an 8-minute hold on 1..6 seats for a user.
 * Enforces both in-memory mutex lock and PostgreSQL transaction check.
 */
export async function placeAtomicSeatHold(params: {
  matchId: number;
  seatIds: number[];
  userUid: string;
  userEmail: string;
  userName: string;
  holdDurationMinutes?: number;
}) {
  const { matchId, seatIds, userUid, userEmail, userName, holdDurationMinutes = 8 } = params;
  const uniqueSeatIds = Array.from(new Set(seatIds));
  if (uniqueSeatIds.length === 0 || uniqueSeatIds.length > 6) {
    throw new Error('You can hold between 1 and 6 seats per reservation.');
  }

  if (!holdLockBroker.acquireSeatMutexes(matchId, uniqueSeatIds)) {
    const conflictErr = new Error('CONFLICT: One or more seats are currently being locked by another user.');
    (conflictErr as any).statusCode = 409;
    throw conflictErr;
  }

  try {
    await sweepExpiredHolds();
    const dbUser = await getOrCreateUser(userUid, userEmail, userName);
    const holdToken = `HOLD-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const holdExpiresAt = new Date(Date.now() + holdDurationMinutes * 60 * 1000);

    const staticSeats = await getStaticStadiumSeats();
    const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));

    const txResult = await db.transaction(async (tx) => {
      const currentRows = await tx
        .select()
        .from(seatInventory)
        .where(
          and(
            eq(seatInventory.matchId, matchId),
            inArray(seatInventory.seatId, uniqueSeatIds)
          )
        );

      if (currentRows.length !== uniqueSeatIds.length) {
        const notFound = new Error('One or more requested seats do not exist for this match.');
        (notFound as any).statusCode = 404;
        throw notFound;
      }

      // Verify all requested seats are AVAILABLE or already held by this same user
      const unavailable = currentRows.filter(
        (r) => r.status !== 'AVAILABLE' && !(r.status === 'HELD' && r.holdUserId === dbUser.id)
      );

      if (unavailable.length > 0) {
        const conflictCodes = unavailable
          .map((r) => seatMetaMap.get(r.seatId)?.seatCode || `#${r.seatId}`)
          .join(', ');
        const err = new Error(
          `CONFLICT: Seats [${conflictCodes}] are no longer available (${unavailable[0].status}).`
        );
        (err as any).statusCode = 409;
        throw err;
      }

      await tx
        .update(seatInventory)
        .set({
          status: 'HELD',
          holdUserId: dbUser.id,
          holdToken,
          holdExpiresAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(seatInventory.matchId, matchId),
            inArray(seatInventory.seatId, uniqueSeatIds)
          )
        );

      // Compute server-authoritative pricing
      const pricingRows = await tx
        .select()
        .from(matchSeatPricing)
        .where(eq(matchSeatPricing.matchId, matchId));
      const priceByCatId = new Map(pricingRows.map((p) => [p.categoryId, p.finalPricePaise]));

      const heldSeatDetails = uniqueSeatIds.map((id) => {
        const meta = seatMetaMap.get(id)!;
        const pricePaise = priceByCatId.get(meta.categoryId) ?? 180000;
        return {
          seatId: id,
          seatCode: meta.seatCode,
          standName: meta.standName,
          blockName: meta.blockName,
          categoryName: meta.categoryName,
          rowNumber: meta.rowNumber,
          seatNumber: meta.seatNumber,
          instanceIndex: meta.instanceIndex,
          pricePaise,
        };
      });

      const totalAmountPaise = heldSeatDetails.reduce((sum, s) => sum + s.pricePaise, 0);

      return {
        holdToken,
        matchId,
        userId: dbUser.id,
        holdExpiresAt: holdExpiresAt.toISOString(),
        seats: heldSeatDetails,
        totalAmountPaise,
      };
    });

    holdLockBroker.registerHold({
      holdToken: txResult.holdToken,
      matchId,
      userId: txResult.userId,
      seatIds: uniqueSeatIds,
      instanceIndices: txResult.seats.map((s) => s.instanceIndex),
      expiresAt: new Date(txResult.holdExpiresAt).getTime(),
    });

    return txResult;
  } finally {
    holdLockBroker.releaseSeatMutexes(matchId, uniqueSeatIds);
  }
}

export async function releaseSeatHold(matchId: number, holdToken: string) {
  try {
    const existing = await db
      .select()
      .from(seatInventory)
      .where(and(eq(seatInventory.matchId, matchId), eq(seatInventory.holdToken, holdToken)));

    if (existing.length === 0) {
      return { releasedSeatIds: [], instanceIndices: [] };
    }

    const seatIds = existing.filter((r) => r.status === 'HELD').map((r) => r.seatId);
    if (seatIds.length > 0) {
      await db
        .update(seatInventory)
        .set({
          status: 'AVAILABLE',
          holdUserId: null,
          holdToken: null,
          holdExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(seatInventory.matchId, matchId), inArray(seatInventory.seatId, seatIds)));
    }

    holdLockBroker.removeHold(holdToken);
    const staticSeats = await getStaticStadiumSeats();
    const instanceMap = new Map(staticSeats.map((s) => [s.id, s.instanceIndex]));

    return {
      releasedSeatIds: seatIds,
      instanceIndices: seatIds.map((id) => instanceMap.get(id) ?? 0),
    };
  } catch (error) {
    console.error('Failed to release seat hold:', error);
    throw new Error('Failed to release seat hold.', { cause: error });
  }
}

/**
 * Initiates checkout for an active hold: creates a PENDING_PAYMENT booking and a Razorpay test order.
 * Calculates all prices exclusively on the server.
 */
export async function createCheckoutOrder(params: {
  matchId: number;
  holdToken: string;
  userUid: string;
  userEmail: string;
  userName: string;
}) {
  try {
    await sweepExpiredHolds();
    const dbUser = await getOrCreateUser(params.userUid, params.userEmail, params.userName);

    const heldRows = await db
      .select()
      .from(seatInventory)
      .where(
        and(
          eq(seatInventory.matchId, params.matchId),
          eq(seatInventory.holdToken, params.holdToken),
          eq(seatInventory.status, 'HELD')
        )
      );

    if (heldRows.length === 0) {
      const err = new Error('Your reservation hold has expired or was not found. Please re-select your seats.');
      (err as any).statusCode = 410;
      throw err;
    }

    const staticSeats = await getStaticStadiumSeats();
    const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));

    const pricingRows = await db
      .select()
      .from(matchSeatPricing)
      .where(eq(matchSeatPricing.matchId, params.matchId));
    const priceByCatId = new Map(pricingRows.map((p) => [p.categoryId, p.finalPricePaise]));

    let totalAmountPaise = 0;
    for (const row of heldRows) {
      const meta = seatMetaMap.get(row.seatId)!;
      totalAmountPaise += priceByCatId.get(meta.categoryId) ?? 180000;
    }

    const bookingReference = `BK-STX-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;
    const razorpayOrderId = `order_test_${crypto.randomBytes(8).toString('hex')}`;
    const idempotencyKey = `idem_${bookingReference}`;

    const [booking] = await db
      .insert(bookings)
      .values({
        bookingReference,
        userId: dbUser.id,
        matchId: params.matchId,
        status: 'PENDING_PAYMENT',
        totalAmountPaise,
        seatCount: heldRows.length,
        holdToken: params.holdToken,
        expiresAt: heldRows[0].holdExpiresAt || new Date(Date.now() + 5 * 60_000),
      })
      .returning();

    const [payment] = await db
      .insert(payments)
      .values({
        bookingId: booking.id,
        razorpayOrderId,
        idempotencyKey,
        amountPaise: totalAmountPaise,
        currency: 'INR',
        status: 'CREATED',
      })
      .returning();

    return {
      bookingId: booking.id,
      bookingReference: booking.bookingReference,
      razorpayOrderId: payment.razorpayOrderId,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_stadiumx_demo_key',
      amountPaise: totalAmountPaise,
      currency: 'INR',
      holdExpiresAt: booking.expiresAt.toISOString(),
    };
  } catch (error) {
    console.error('Checkout creation failed:', error);
    throw error;
  }
}

/**
 * Verifies Razorpay signature & idempotency key, converts HELD -> BOOKED inside a Postgres transaction,
 * enforces UNIQUE (match_id, seat_id) on booking_seats, handles late-payment auto-refunds if hold expired,
 * and mints HMAC-signed QR tickets.
 */
export async function confirmPaymentAndIssueTickets(params: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
  idempotencyKey?: string;
}) {
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = params;

  const isSignatureValid = verifyRazorpaySignature(
    razorpayOrderId,
    razorpayPaymentId,
    razorpaySignature
  );
  if (!isSignatureValid) {
    const err = new Error('Invalid payment signature verification.');
    (err as any).statusCode = 400;
    throw err;
  }

  const [paymentRow] = await db
    .select()
    .from(payments)
    .where(eq(payments.razorpayOrderId, razorpayOrderId));

  if (!paymentRow) {
    const err = new Error('Payment order not found.');
    (err as any).statusCode = 404;
    throw err;
  }

  // Idempotency guard: if already captured, return existing confirmed booking & tickets
  if (paymentRow.status === 'CAPTURED') {
    const existingDetails = await getBookingWithTicketsById(paymentRow.bookingId);
    return {
      idempotentReplay: true,
      ...existingDetails,
      instanceIndices: existingDetails.seats.map((s) => s.instanceIndex),
    };
  }

  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, paymentRow.bookingId));

  const staticSeats = await getStaticStadiumSeats();
  const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));

  const pricingRows = await db
    .select()
    .from(matchSeatPricing)
    .where(eq(matchSeatPricing.matchId, booking.matchId));
  const priceByCatId = new Map(pricingRows.map((p) => [p.categoryId, p.finalPricePaise]));

  const result = await db.transaction(async (tx) => {
    const heldRows = await tx
      .select()
      .from(seatInventory)
      .where(
        and(
          eq(seatInventory.matchId, booking.matchId),
          eq(seatInventory.holdToken, booking.holdToken)
        )
      );

    // Late payment after hold expiry check: if seats were lost, trigger automatic refund path
    const allStillHeldByUser =
      heldRows.length === booking.seatCount &&
      heldRows.every(
        (r) =>
          (r.status === 'HELD' && r.holdUserId === booking.userId) ||
          r.status === 'AVAILABLE'
      );

    if (!allStillHeldByUser) {
      await tx
        .update(payments)
        .set({
          razorpayPaymentId,
          razorpaySignature,
          status: 'LATE_REFUND_INITIATED',
        })
        .where(eq(payments.id, paymentRow.id));

      await tx
        .update(bookings)
        .set({
          status: 'REFUNDED',
          refundAmountPaise: booking.totalAmountPaise,
        })
        .where(eq(bookings.id, booking.id));

      const lateErr = new Error(
        'Hold expired before payment webhook arrived and seats were taken. Automatic full refund has been initiated.'
      );
      (lateErr as any).statusCode = 409;
      throw lateErr;
    }

    const seatIds = heldRows.map((r) => r.seatId);

    // Insert into booking_seats (protected by UNIQUE uq_confirmed_match_seat (match_id, seat_id))
    for (const seatId of seatIds) {
      const meta = seatMetaMap.get(seatId)!;
      const pricePaise = priceByCatId.get(meta.categoryId) ?? 180000;
      await tx.insert(bookingSeats).values({
        bookingId: booking.id,
        matchId: booking.matchId,
        seatId,
        pricePaise,
      });
    }

    // Update seat_inventory -> BOOKED
    await tx
      .update(seatInventory)
      .set({
        status: 'BOOKED',
        bookingId: booking.id,
        holdToken: null,
        holdExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(seatInventory.matchId, booking.matchId),
          inArray(seatInventory.seatId, seatIds)
        )
      );

    // Update booking -> CONFIRMED
    await tx
      .update(bookings)
      .set({ status: 'CONFIRMED' })
      .where(eq(bookings.id, booking.id));

    // Update payment -> CAPTURED
    await tx
      .update(payments)
      .set({
        razorpayPaymentId,
        razorpaySignature,
        status: 'CAPTURED',
      })
      .where(eq(payments.id, paymentRow.id));

    // Mint signed QR tickets
    const now = Date.now();
    for (const seatId of seatIds) {
      const meta = seatMetaMap.get(seatId)!;
      const ticketCode = `TKT-${booking.bookingReference.replace('BK-', '')}-${meta.seatCode}`;
      const qrSignedToken = signQrTicketToken({
        ticketCode,
        bookingReference: booking.bookingReference,
        matchId: booking.matchId,
        seatId,
        seatCode: meta.seatCode,
        userId: booking.userId,
        issuedAt: now,
        expiresAt: now + 30 * 24 * 3600 * 1000,
      });

      await tx.insert(tickets).values({
        ticketCode,
        bookingId: booking.id,
        matchId: booking.matchId,
        seatId,
        userId: booking.userId,
        qrSignedToken,
        status: 'VALID',
      });
    }

    return {
      seatIds,
      instanceIndices: seatIds.map((id) => seatMetaMap.get(id)?.instanceIndex ?? 0),
    };
  });

  holdLockBroker.removeHold(booking.holdToken);
  const fullBooking = await getBookingWithTicketsById(booking.id);

  return {
    idempotentReplay: false,
    ...fullBooking,
    seatIds: result.seatIds,
    instanceIndices: result.instanceIndices,
  };
}

export async function getBookingWithTicketsById(bookingId: number) {
  try {
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
    const [match] = await db.select().from(matches).where(eq(matches.id, booking.matchId));
    const [stadium] = match
      ? await db.select().from(stadiums).where(eq(stadiums.id, match.stadiumId))
      : [];
    const allTeams = await db.select().from(teams);
    const teamById = new Map(allTeams.map((t) => [t.id, t]));
    const [payment] = await db
      .select({
        id: payments.id,
        razorpayOrderId: payments.razorpayOrderId,
        razorpayPaymentId: payments.razorpayPaymentId,
        amountPaise: payments.amountPaise,
        currency: payments.currency,
        status: payments.status,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(desc(payments.createdAt))
      .limit(1);

    const bSeats = await db
      .select()
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, bookingId));
    const bTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.bookingId, bookingId));

    const staticSeats = await getStaticStadiumSeats();
    const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));

    return {
      booking,
      match: match
        ? {
            ...match,
            homeTeam: teamById.get(match.homeTeamId) ?? null,
            awayTeam: teamById.get(match.awayTeamId) ?? null,
          }
        : null,
      stadium: stadium
        ? {
            id: stadium.id,
            code: stadium.code,
            name: stadium.name,
            city: stadium.city,
            country: stadium.country,
          }
        : null,
      payment: payment ?? null,
      seats: bSeats.map((bs) => {
        const meta = seatMetaMap.get(bs.seatId)!;
        return {
          ...bs,
          seatCode: meta.seatCode,
          standName: meta.standName,
          blockName: meta.blockName,
          categoryName: meta.categoryName,
          rowNumber: meta.rowNumber,
          seatNumber: meta.seatNumber,
          instanceIndex: meta.instanceIndex,
        };
      }),
      tickets: bTickets.map((t) => {
        const meta = seatMetaMap.get(t.seatId)!;
        return {
          ...t,
          seatCode: meta.seatCode,
          standCode: meta.standCode,
          standName: meta.standName,
          blockCode: meta.blockCode,
          blockName: meta.blockName,
          categoryCode: meta.categoryCode,
          categoryName: meta.categoryName,
          rowNumber: meta.rowNumber,
          seatNumber: meta.seatNumber,
        };
      }),
    };
  } catch (error) {
    console.error('Failed to fetch booking details:', error);
    throw new Error('Failed to load booking and tickets.', { cause: error });
  }
}

export async function listUserBookings(userUid: string, userEmail: string) {
  try {
    await ensureStadiumSeeded();
    const dbUser = await getOrCreateUser(userUid, userEmail);
    const userBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.userId, dbUser.id))
      .orderBy(desc(bookings.createdAt));

    const results = [];
    for (const b of userBookings) {
      if (b.status === 'PENDING_PAYMENT') continue;
      const detail = await getBookingWithTicketsById(b.id);
      results.push(detail);
    }
    return results;
  } catch (error) {
    console.error('Failed to list user bookings:', error);
    throw new Error('Failed to load booking history.', { cause: error });
  }
}

export async function cancelBookingAndRefund(params: {
  bookingId: number;
  userUid: string;
  userEmail: string;
}) {
  try {
    const dbUser = await getOrCreateUser(params.userUid, params.userEmail);
    const [booking] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, params.bookingId));

    if (!booking) {
      throw new Error('Booking not found.');
    }
    if (booking.userId !== dbUser.id && dbUser.role !== 'ADMIN') {
      throw new Error('You are not authorized to cancel this booking.');
    }
    if (booking.status !== 'CONFIRMED') {
      throw new Error(`Booking cannot be cancelled in state ${booking.status}.`);
    }

    const [match] = await db.select().from(matches).where(eq(matches.id, booking.matchId));
    const policy = JSON.parse(match.refundPolicyJson || '{"fullRefundHoursBefore":48,"partialRefundPct":70}');
    const { refundAmountPaise, refundTier } = calculateRefundPaise(
      booking.totalAmountPaise,
      match.startTime,
      new Date(),
      policy
    );

    const bSeats = await db
      .select()
      .from(bookingSeats)
      .where(eq(bookingSeats.bookingId, booking.id));
    const seatIds = bSeats.map((s) => s.seatId);

    const staticSeats = await getStaticStadiumSeats();
    const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));

    await db.transaction(async (tx) => {
      await tx
        .update(bookings)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          refundAmountPaise,
        })
        .where(eq(bookings.id, booking.id));

      await tx
        .update(tickets)
        .set({ status: 'CANCELLED' })
        .where(eq(tickets.bookingId, booking.id));

      await tx
        .update(payments)
        .set({ status: refundAmountPaise > 0 ? 'REFUNDED' : 'CAPTURED' })
        .where(eq(payments.bookingId, booking.id));

      await tx
        .delete(bookingSeats)
        .where(eq(bookingSeats.bookingId, booking.id));

      if (seatIds.length > 0) {
        await tx
          .update(seatInventory)
          .set({
            status: 'AVAILABLE',
            bookingId: null,
            holdUserId: null,
            holdToken: null,
            holdExpiresAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(seatInventory.matchId, booking.matchId),
              inArray(seatInventory.seatId, seatIds)
            )
          );
      }

      await tx.insert(auditLogs).values({
        actorUserId: dbUser.id,
        actorRole: dbUser.role,
        action: 'BOOKING_CANCELLED',
        entityType: 'BOOKING',
        entityId: booking.bookingReference,
        metadataJson: JSON.stringify({ refundAmountPaise, refundTier }),
      });
    });

    return {
      bookingId: booking.id,
      bookingReference: booking.bookingReference,
      matchId: booking.matchId,
      refundAmountPaise,
      refundTier,
      releasedSeatIds: seatIds,
      instanceIndices: seatIds.map((id) => seatMetaMap.get(id)?.instanceIndex ?? 0),
    };
  } catch (error) {
    console.error('Failed to cancel booking:', error);
    throw error;
  }
}

/**
 * Gate Staff QR Validation:
 * Supports both signed STX1 QR tokens (from camera / image / pass scan) and
 * authorized manual ticketCode lookup for GATE_STAFF/ADMIN fallback.
 * Performs cryptographic verification, booking & payment status check,
 * match alignment, atomic VALID -> USED transition, and immutable ScanLog insert.
 */
export async function validateGateQrToken(params: {
  qrToken?: string;
  ticketCode?: string;
  expectedMatchId?: number;
  staffUid: string;
  staffEmail: string;
  staffName: string;
  staffRole?: 'GATE_STAFF' | 'ADMIN';
}) {
  try {
    await ensureStadiumSeeded();
    const staffUser = await getOrCreateUser(
      params.staffUid,
      params.staffEmail,
      params.staffName,
      params.staffRole || 'GATE_STAFF'
    );

    let resolvedTicketCode: string | null = null;
    let payloadMeta: any = null;

    if (params.qrToken && params.qrToken.trim()) {
      const verification = verifyQrTicketToken(params.qrToken.trim());
      if (!verification.valid || !verification.payload) {
        const failStatus =
          verification.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_SIGNATURE';
        await db.insert(scanLogs).values({
          ticketId: null,
          matchId: params.expectedMatchId ?? null,
          scannedByUserId: staffUser.id,
          result: failStatus,
          details: `Rejected QR token (${verification.reason || 'INVALID'})`,
        });
        return {
          valid: false,
          status: failStatus,
          message:
            failStatus === 'TOKEN_EXPIRED'
              ? 'Ticket pass has expired. Reject entry and direct attendee to box office.'
              : `Invalid or tampered QR signature (${verification.reason}). Reject entry.`,
          payload: verification.payload,
        };
      }
      payloadMeta = verification.payload;
      resolvedTicketCode = verification.payload.ticketCode;
    } else if (params.ticketCode && params.ticketCode.trim()) {
      resolvedTicketCode = params.ticketCode.trim().toUpperCase();
    } else {
      return {
        valid: false,
        status: 'INVALID_SIGNATURE' as const,
        message: 'No QR payload or ticket reference supplied.',
      };
    }

    const [ticket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.ticketCode, resolvedTicketCode));

    if (!ticket) {
      await db.insert(scanLogs).values({
        matchId: params.expectedMatchId ?? payloadMeta?.matchId ?? null,
        scannedByUserId: staffUser.id,
        result: 'NOT_FOUND',
        details: `Ticket code ${resolvedTicketCode} not found in database`,
      });
      return {
        valid: false,
        status: 'NOT_FOUND' as const,
        message: `Ticket ${resolvedTicketCode} does not exist in system records.`,
      };
    }

    // Re-verify stored signed token integrity even during manual lookup
    const dbTokenCheck = verifyQrTicketToken(ticket.qrSignedToken);
    if (!dbTokenCheck.valid || !dbTokenCheck.payload) {
      const failStatus =
        dbTokenCheck.reason === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'INVALID_SIGNATURE';
      await db.insert(scanLogs).values({
        ticketId: ticket.id,
        matchId: ticket.matchId,
        scannedByUserId: staffUser.id,
        result: failStatus,
        details: `Ticket ${ticket.ticketCode} failed stored signature check (${dbTokenCheck.reason})`,
      });
      return {
        valid: false,
        status: failStatus,
        message:
          failStatus === 'TOKEN_EXPIRED'
            ? `Ticket ${ticket.ticketCode} is expired.`
            : `Ticket ${ticket.ticketCode} failed cryptographic verification.`,
      };
    }
    const verifiedPayload = payloadMeta || dbTokenCheck.payload;

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, ticket.bookingId));
    const [payment] = booking
      ? await db.select().from(payments).where(eq(payments.bookingId, booking.id))
      : [];
    const [match] = await db.select().from(matches).where(eq(matches.id, ticket.matchId));
    const [holder] = await db.select().from(users).where(eq(users.id, ticket.userId));

    const staticSeats = await getStaticStadiumSeats();
    const seatMeta = staticSeats.find((s) => s.id === ticket.seatId);

    const richDetails = {
      ticketCode: ticket.ticketCode,
      bookingReference: booking?.bookingReference ?? verifiedPayload.bookingReference,
      matchId: ticket.matchId,
      matchTitle: match?.title ?? `Match #${ticket.matchId}`,
      matchStartTime: match?.startTime ?? null,
      seatCode: seatMeta?.seatCode ?? verifiedPayload.seatCode,
      standName: seatMeta?.standName ?? '',
      blockName: seatMeta?.blockName ?? '',
      categoryName: seatMeta?.categoryName ?? '',
      rowNumber: seatMeta?.rowNumber ?? 0,
      seatNumber: seatMeta?.seatNumber ?? 0,
      attendeeName: holder?.name ?? 'Ticket Holder',
      paymentStatus: payment?.status ?? 'UNKNOWN',
      bookingStatus: booking?.status ?? 'UNKNOWN',
    };

    if (params.expectedMatchId && ticket.matchId !== params.expectedMatchId) {
      await db.insert(scanLogs).values({
        ticketId: ticket.id,
        matchId: params.expectedMatchId,
        scannedByUserId: staffUser.id,
        result: 'WRONG_MATCH',
        details: `Wrong match: ${ticket.ticketCode} belongs to Match #${ticket.matchId} (${match?.title || ''}), gate set to Match #${params.expectedMatchId}`,
      });
      return {
        valid: false,
        status: 'WRONG_MATCH' as const,
        message: `Wrong match: Ticket belongs to "${match?.title || `Match #${ticket.matchId}`}", not the active gate match.`,
        ticket,
        payload: verifiedPayload,
        details: richDetails,
      };
    }

    if (ticket.status === 'CANCELLED' || booking?.status === 'CANCELLED' || booking?.status === 'REFUNDED') {
      await db.insert(scanLogs).values({
        ticketId: ticket.id,
        matchId: ticket.matchId,
        scannedByUserId: staffUser.id,
        result: 'CANCELLED_TICKET',
        details: `Attempted entry on cancelled/refunded ticket ${ticket.ticketCode}`,
      });
      return {
        valid: false,
        status: 'CANCELLED_TICKET' as const,
        message: `Cancelled ticket: Booking ${richDetails.bookingReference} was cancelled or refunded.`,
        ticket,
        payload: verifiedPayload,
        details: richDetails,
      };
    }

    if (!booking || booking.status !== 'CONFIRMED' || !payment || payment.status !== 'CAPTURED') {
      await db.insert(scanLogs).values({
        ticketId: ticket.id,
        matchId: ticket.matchId,
        scannedByUserId: staffUser.id,
        result: 'UNPAID_BOOKING',
        details: `Unpaid or unconfirmed booking for ticket ${ticket.ticketCode} (booking=${booking?.status}, payment=${payment?.status})`,
      });
      return {
        valid: false,
        status: 'UNPAID_BOOKING' as const,
        message: `Unpaid booking: Payment has not been captured for ${richDetails.bookingReference}.`,
        ticket,
        payload: verifiedPayload,
        details: richDetails,
      };
    }

    const scannedAt = new Date();
    // Atomic single-use transition: prevents concurrent turnstile double-entry race
    const updatedRows = await db
      .update(tickets)
      .set({
        status: 'USED',
        scannedAt,
        scannedByUserId: staffUser.id,
      })
      .where(and(eq(tickets.id, ticket.id), eq(tickets.status, 'VALID')))
      .returning();

    if (updatedRows.length === 0) {
      // Already used before this request completed
      const [latest] = await db.select().from(tickets).where(eq(tickets.id, ticket.id));
      await db.insert(scanLogs).values({
        ticketId: ticket.id,
        matchId: ticket.matchId,
        scannedByUserId: staffUser.id,
        result: 'DUPLICATE_SCAN',
        details: `Duplicate scan blocked for ${ticket.ticketCode} (previously scanned at ${latest?.scannedAt?.toISOString() || 'unknown'})`,
      });
      return {
        valid: false,
        status: 'DUPLICATE_SCAN' as const,
        message: `Already used: Ticket ${ticket.ticketCode} was already scanned at ${
          latest?.scannedAt ? latest.scannedAt.toLocaleString() : 'an earlier time'
        }.`,
        ticket: latest ?? ticket,
        payload: verifiedPayload,
        details: {
          ...richDetails,
          previousScannedAt: latest?.scannedAt?.toISOString() ?? null,
        },
      };
    }

    const updatedTicket = updatedRows[0];
    await db.insert(scanLogs).values({
      ticketId: ticket.id,
      matchId: ticket.matchId,
      scannedByUserId: staffUser.id,
      result: 'VALID',
      details: `Entry granted for Seat ${richDetails.seatCode} (${ticket.ticketCode}) · ${richDetails.standName}`,
    });

    return {
      valid: true,
      status: 'VALID' as const,
      message: `Entry granted for ${richDetails.seatCode} (${richDetails.standName}, ${richDetails.blockName}). Ticket marked USED.`,
      ticket: updatedTicket,
      payload: verifiedPayload,
      details: {
        ...richDetails,
        scannedAt: updatedTicket.scannedAt?.toISOString() ?? scannedAt.toISOString(),
      },
    };
  } catch (error) {
    console.error('Gate QR validation failed:', error);
    throw new Error('Failed to validate QR ticket.', { cause: error });
  }
}

export async function getGateTurnstilePasses(matchId?: number) {
  await ensureStadiumSeeded();
  const staticSeats = await getStaticStadiumSeats();
  const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));
  const allMatches = await db.select().from(matches);
  const matchMap = new Map(allMatches.map((m) => [m.id, m]));
  const allUsers = await db.select().from(users);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));

  const rows = matchId
    ? await db
        .select()
        .from(tickets)
        .where(eq(tickets.matchId, matchId))
        .orderBy(desc(tickets.createdAt))
        .limit(12)
    : await db.select().from(tickets).orderBy(desc(tickets.createdAt)).limit(12);

  return rows.map((t) => {
    const meta = seatMetaMap.get(t.seatId);
    const match = matchMap.get(t.matchId);
    const holder = userMap.get(t.userId);
    return {
      id: t.id,
      ticketCode: t.ticketCode,
      matchId: t.matchId,
      matchTitle: match?.title ?? `Match #${t.matchId}`,
      status: t.status,
      scannedAt: t.scannedAt,
      qrSignedToken: t.qrSignedToken,
      seatCode: meta?.seatCode ?? '',
      standName: meta?.standName ?? '',
      blockName: meta?.blockName ?? '',
      rowNumber: meta?.rowNumber ?? 0,
      seatNumber: meta?.seatNumber ?? 0,
      attendeeName: holder?.name ?? 'Ticket Holder',
    };
  });
}

export async function getGateScanLogs(matchId?: number, limit = 25) {
  await ensureStadiumSeeded();
  const rows = matchId
    ? await db
        .select()
        .from(scanLogs)
        .where(eq(scanLogs.matchId, matchId))
        .orderBy(desc(scanLogs.scannedAt))
        .limit(limit)
    : await db.select().from(scanLogs).orderBy(desc(scanLogs.scannedAt)).limit(limit);

  const ticketIds = Array.from(new Set(rows.map((r) => r.ticketId).filter((x): x is number => x !== null)));
  const ticketRows =
    ticketIds.length > 0 ? await db.select().from(tickets).where(inArray(tickets.id, ticketIds)) : [];
  const ticketMap = new Map(ticketRows.map((t) => [t.id, t]));
  const staticSeats = await getStaticStadiumSeats();
  const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));

  return rows.map((r) => {
    const t = r.ticketId ? ticketMap.get(r.ticketId) : null;
    const seat = t ? seatMetaMap.get(t.seatId) : null;
    return {
      id: r.id,
      result: r.result,
      details: r.details,
      scannedAt: r.scannedAt,
      matchId: r.matchId,
      ticketCode: t?.ticketCode ?? null,
      seatCode: seat?.seatCode ?? null,
      standName: seat?.standName ?? null,
    };
  });
}

export async function getAdminAnalytics(matchId: number, daysFilter = 0) {
  try {
    await ensureStadiumSeeded();
    await sweepExpiredHolds();
    const staticSeats = await getStaticStadiumSeats();
    const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));

    const invRows = await db
      .select()
      .from(seatInventory)
      .where(eq(seatInventory.matchId, matchId));

    const matchBookings = await db
      .select()
      .from(bookings)
      .where(eq(bookings.matchId, matchId));

    const allMatches = await db.select().from(matches);
    const upcomingMatchesCount = allMatches.filter((m) => m.status === 'UPCOMING' || m.status === 'LIVE').length;

    const matchBookingIds = matchBookings.map((b) => b.id);
    const matchPayments =
      matchBookingIds.length > 0
        ? await db.select().from(payments).where(inArray(payments.bookingId, matchBookingIds))
        : [];
    const matchTickets = await db.select().from(tickets).where(eq(tickets.matchId, matchId));

    const pricingRows = await db
      .select()
      .from(matchSeatPricing)
      .where(eq(matchSeatPricing.matchId, matchId));
    const priceByCatId = new Map(pricingRows.map((p) => [p.categoryId, p.finalPricePaise]));

    const standStatsMap = new Map<
      string,
      { standName: string; total: number; booked: number; available: number; held: number; blocked: number; revenuePaise: number }
    >();
    const categoryStatsMap = new Map<
      string,
      { categoryId: number; categoryName: string; colorHex: string; finalPricePaise: number; total: number; booked: number; available: number; revenuePaise: number }
    >();
    const blockStatsMap = new Map<
      string,
      { blockCode: string; blockName: string; standCode: string; standName: string; tier: number; categoryName: string; total: number; booked: number; available: number; held: number; blocked: number; revenuePaise: number }
    >();

    let totalAvailable = 0;
    let totalHeld = 0;
    let totalBlocked = 0;

    for (const r of invRows) {
      const meta = seatMetaMap.get(r.seatId);
      if (!meta) continue;
      const price = priceByCatId.get(meta.categoryId) ?? 180000;

      if (r.status === 'AVAILABLE') totalAvailable++;
      else if (r.status === 'HELD') totalHeld++;
      else if (r.status === 'BLOCKED') totalBlocked++;

      let st = standStatsMap.get(meta.standCode);
      if (!st) {
        st = { standName: meta.standName, total: 0, booked: 0, available: 0, held: 0, blocked: 0, revenuePaise: 0 };
        standStatsMap.set(meta.standCode, st);
      }
      st.total++;
      if (r.status === 'BOOKED') {
        st.booked++;
        st.revenuePaise += price;
      } else if (r.status === 'AVAILABLE') {
        st.available++;
      } else if (r.status === 'HELD') {
        st.held++;
      } else if (r.status === 'BLOCKED') {
        st.blocked++;
      }

      let ct = categoryStatsMap.get(meta.categoryCode);
      if (!ct) {
        ct = {
          categoryId: meta.categoryId,
          categoryName: meta.categoryName,
          colorHex: meta.colorHex,
          finalPricePaise: price,
          total: 0,
          booked: 0,
          available: 0,
          revenuePaise: 0,
        };
        categoryStatsMap.set(meta.categoryCode, ct);
      }
      ct.total++;
      if (r.status === 'BOOKED') {
        ct.booked++;
        ct.revenuePaise += price;
      } else if (r.status === 'AVAILABLE') {
        ct.available++;
      }

      let bl = blockStatsMap.get(meta.blockCode);
      if (!bl) {
        bl = {
          blockCode: meta.blockCode,
          blockName: meta.blockName,
          standCode: meta.standCode,
          standName: meta.standName,
          tier: meta.tier,
          categoryName: meta.categoryName,
          total: 0,
          booked: 0,
          available: 0,
          held: 0,
          blocked: 0,
          revenuePaise: 0,
        };
        blockStatsMap.set(meta.blockCode, bl);
      }
      bl.total++;
      if (r.status === 'BOOKED') {
        bl.booked++;
        bl.revenuePaise += price;
      } else if (r.status === 'AVAILABLE') bl.available++;
      else if (r.status === 'HELD') bl.held++;
      else if (r.status === 'BLOCKED') bl.blocked++;
    }

    const cutoffMs = daysFilter > 0 ? Date.now() - daysFilter * 24 * 3600 * 1000 : 0;
    const filteredBookings = matchBookings.filter((b) => new Date(b.createdAt).getTime() >= cutoffMs);

    // Real time-series aggregation from database bookings
    const timelineMap = new Map<
      string,
      { date: string; confirmedCount: number; cancelledCount: number; totalCount: number; revenuePaise: number }
    >();
    for (const b of filteredBookings) {
      const dateKey = new Date(b.createdAt).toISOString().slice(0, 10);
      const entry = timelineMap.get(dateKey) ?? {
        date: dateKey,
        confirmedCount: 0,
        cancelledCount: 0,
        totalCount: 0,
        revenuePaise: 0,
      };
      entry.totalCount++;
      if (b.status === 'CONFIRMED') {
        entry.confirmedCount++;
        entry.revenuePaise += b.totalAmountPaise;
      } else if (b.status === 'CANCELLED' || b.status === 'REFUNDED') {
        entry.cancelledCount++;
      }
      timelineMap.set(dateKey, entry);
    }

    const paymentStatusMap = new Map<string, { status: string; count: number; amountPaise: number }>();
    for (const p of matchPayments) {
      const row = paymentStatusMap.get(p.status) ?? { status: p.status, count: 0, amountPaise: 0 };
      row.count++;
      row.amountPaise += p.amountPaise;
      paymentStatusMap.set(p.status, row);
    }

    const usedTicketsCount = matchTickets.filter((t) => t.status === 'USED').length;

    const topViewed = [...invRows]
      .sort((a, b) => b.viewCount - a.viewCount)
      .slice(0, 8)
      .map((r) => {
        const meta = seatMetaMap.get(r.seatId)!;
        return {
          seatId: r.seatId,
          seatCode: meta.seatCode,
          standName: meta.standName,
          categoryName: meta.categoryName,
          viewQualityScore: meta.viewQualityScore,
          viewCount: r.viewCount,
          status: r.status,
        };
      });

    const recentAuditLogs = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(25);

    const recentScans = await db
      .select()
      .from(scanLogs)
      .orderBy(desc(scanLogs.scannedAt))
      .limit(20);

    const totalRevenuePaise = Array.from(standStatsMap.values()).reduce(
      (sum, s) => sum + s.revenuePaise,
      0
    );
    const totalBooked = Array.from(standStatsMap.values()).reduce((sum, s) => sum + s.booked, 0);

    return {
      matchId,
      totalCapacity: invRows.length,
      totalBooked,
      totalAvailable,
      totalHeld,
      totalBlocked,
      occupancyPct: invRows.length > 0 ? Number(((totalBooked / invRows.length) * 100).toFixed(1)) : 0,
      totalRevenuePaise,
      totalBookingsCount: matchBookings.length,
      confirmedBookingsCount: matchBookings.filter((b) => b.status === 'CONFIRMED').length,
      upcomingMatchesCount,
      standOccupancy: Array.from(standStatsMap.entries()).map(([code, data]) => ({
        standCode: code,
        ...data,
        occupancyPct: data.total > 0 ? Math.round((data.booked / data.total) * 100) : 0,
      })),
      categoryBreakdown: Array.from(categoryStatsMap.entries()).map(([code, data]) => ({
        categoryCode: code,
        ...data,
        occupancyPct: data.total > 0 ? Math.round((data.booked / data.total) * 100) : 0,
      })),
      blockOccupancy: Array.from(blockStatsMap.values()).map((bl) => ({
        ...bl,
        occupancyPct: bl.total > 0 ? Math.round((bl.booked / bl.total) * 100) : 0,
      })),
      timelineSeries: Array.from(timelineMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      paymentStatusBreakdown: Array.from(paymentStatusMap.values()),
      conversionFunnel: {
        activeHeldSeats: totalHeld,
        totalBookingAttempts: matchBookings.length,
        confirmedBookings: matchBookings.filter((b) => b.status === 'CONFIRMED').length,
        ticketsIssued: matchTickets.length,
        ticketsUsedAtGate: usedTicketsCount,
      },
      topViewedSeats: topViewed,
      recentAuditLogs,
      recentScans,
    };
  } catch (error) {
    console.error('Failed to compute admin analytics:', error);
    throw new Error('Failed to load operational analytics.', { cause: error });
  }
}

export async function getAdminReferenceData() {
  await ensureStadiumSeeded();
  const [stadiumsList, teamsList, categoriesList] = await Promise.all([
    db.select().from(stadiums),
    db.select().from(teams).orderBy(asc(teams.name)),
    db.select().from(seatCategories).orderBy(asc(seatCategories.tierLevel)),
  ]);
  return {
    stadiums: stadiumsList.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      city: s.city,
      country: s.country,
      capacity: s.capacity,
    })),
    teams: teamsList,
    categories: categoriesList,
  };
}

export async function createAdminMatch(params: {
  stadiumId: number;
  homeTeamId: number;
  awayTeamId: number;
  tournament: string;
  title: string;
  startTimeIso: string;
  status: 'UPCOMING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  demandMultiplier: number;
  rivalryMultiplier: number;
  weekendMultiplier: number;
  categoryBasePrices?: Array<{ categoryId: number; basePricePaise: number }>;
  adminUid: string;
  adminEmail: string;
}) {
  await ensureStadiumSeeded();
  if (params.homeTeamId === params.awayTeamId) {
    throw new Error('Home team and away team must be different.');
  }
  const adminUser = await getOrCreateUser(params.adminUid, params.adminEmail, 'Venue Director', 'ADMIN');
  const staticSeats = await getStaticStadiumSeats();
  const cats = await db.select().from(seatCategories).where(eq(seatCategories.stadiumId, params.stadiumId));
  const customPriceMap = new Map(
    (params.categoryBasePrices || []).map((c) => [c.categoryId, c.basePricePaise])
  );

  const createdMatch = await db.transaction(async (tx) => {
    const [m] = await tx
      .insert(matches)
      .values({
        stadiumId: params.stadiumId,
        homeTeamId: params.homeTeamId,
        awayTeamId: params.awayTeamId,
        tournament: params.tournament,
        title: params.title,
        startTime: new Date(params.startTimeIso),
        status: params.status,
        demandMultiplier: params.demandMultiplier,
        rivalryMultiplier: params.rivalryMultiplier,
        weekendMultiplier: params.weekendMultiplier,
      })
      .returning();

    const pricingValues = cats.map((cat) => {
      const basePrice = customPriceMap.get(cat.id) ?? cat.basePricePaise;
      const { combinedMultiplier, finalPricePaise } = computeDynamicPricePaise(basePrice, {
        demand: m.demandMultiplier,
        rivalry: m.rivalryMultiplier,
        weekend: m.weekendMultiplier,
      });
      return {
        matchId: m.id,
        categoryId: cat.id,
        basePricePaise: basePrice,
        dynamicMultiplier: combinedMultiplier,
        finalPricePaise,
      };
    });
    if (pricingValues.length > 0) {
      await tx.insert(matchSeatPricing).values(pricingValues);
    }

    const INV_BATCH = 800;
    for (let i = 0; i < staticSeats.length; i += INV_BATCH) {
      const slice = staticSeats.slice(i, i + INV_BATCH);
      await tx.insert(seatInventory).values(
        slice.map((sr) => ({
          matchId: m.id,
          seatId: sr.id,
          blockId: sr.blockId,
          status: 'AVAILABLE',
          viewCount: 0,
        }))
      );
    }

    await tx.insert(auditLogs).values({
      actorUserId: adminUser.id,
      actorRole: 'ADMIN',
      action: 'MATCH_CREATED',
      entityType: 'MATCH',
      entityId: String(m.id),
      metadataJson: JSON.stringify({ title: m.title, startTime: m.startTime }),
    });

    return m;
  });

  return createdMatch;
}

export async function updateAdminMatch(params: {
  matchId: number;
  stadiumId?: number;
  homeTeamId?: number;
  awayTeamId?: number;
  tournament?: string;
  title?: string;
  startTimeIso?: string;
  status?: 'UPCOMING' | 'LIVE' | 'COMPLETED' | 'CANCELLED';
  demandMultiplier?: number;
  rivalryMultiplier?: number;
  weekendMultiplier?: number;
  categoryBasePrices?: Array<{ categoryId: number; basePricePaise: number }>;
  adminUid: string;
  adminEmail: string;
}) {
  const adminUser = await getOrCreateUser(params.adminUid, params.adminEmail, 'Venue Director', 'ADMIN');
  const [existing] = await db.select().from(matches).where(eq(matches.id, params.matchId));
  if (!existing) throw new Error('Match not found.');

  const nextHome = params.homeTeamId ?? existing.homeTeamId;
  const nextAway = params.awayTeamId ?? existing.awayTeamId;
  if (nextHome === nextAway) {
    throw new Error('Home team and away team must be different.');
  }

  const nextDemand = params.demandMultiplier ?? existing.demandMultiplier;
  const nextRivalry = params.rivalryMultiplier ?? existing.rivalryMultiplier;
  const nextWeekend = params.weekendMultiplier ?? existing.weekendMultiplier;

  const updatedMatch = await db.transaction(async (tx) => {
    const [m] = await tx
      .update(matches)
      .set({
        stadiumId: params.stadiumId ?? existing.stadiumId,
        homeTeamId: nextHome,
        awayTeamId: nextAway,
        tournament: params.tournament ?? existing.tournament,
        title: params.title ?? existing.title,
        startTime: params.startTimeIso ? new Date(params.startTimeIso) : existing.startTime,
        status: params.status ?? existing.status,
        demandMultiplier: nextDemand,
        rivalryMultiplier: nextRivalry,
        weekendMultiplier: nextWeekend,
      })
      .where(eq(matches.id, params.matchId))
      .returning();

    const baseOverrideMap = new Map(
      (params.categoryBasePrices || []).map((c) => [c.categoryId, c.basePricePaise])
    );
    const currentPricing = await tx
      .select()
      .from(matchSeatPricing)
      .where(eq(matchSeatPricing.matchId, params.matchId));

    for (const p of currentPricing) {
      const nextBase = baseOverrideMap.get(p.categoryId) ?? p.basePricePaise;
      const { combinedMultiplier, finalPricePaise } = computeDynamicPricePaise(nextBase, {
        demand: nextDemand,
        rivalry: nextRivalry,
        weekend: nextWeekend,
      });
      await tx
        .update(matchSeatPricing)
        .set({
          basePricePaise: nextBase,
          dynamicMultiplier: combinedMultiplier,
          finalPricePaise,
        })
        .where(eq(matchSeatPricing.id, p.id));
    }

    await tx.insert(auditLogs).values({
      actorUserId: adminUser.id,
      actorRole: 'ADMIN',
      action: 'MATCH_UPDATED',
      entityType: 'MATCH',
      entityId: String(params.matchId),
      metadataJson: JSON.stringify({
        title: m.title,
        status: m.status,
        startTime: m.startTime,
      }),
    });

    return m;
  });

  return updatedMatch;
}

export async function updateMatchDynamicMultipliers(params: {
  matchId: number;
  demandMultiplier: number;
  rivalryMultiplier: number;
  weekendMultiplier: number;
  adminUid: string;
  adminEmail: string;
}) {
  return updateAdminMatch(params);
}

/**
 * Blocks or unblocks seats ONLY if they are currently AVAILABLE or BLOCKED.
 * Strictly protects CONFIRMED BOOKED and active HELD seats from accidental overwrite.
 */
export async function adminSetSeatBlockState(params: {
  matchId: number;
  seatIds: number[];
  targetStatus: 'BLOCKED' | 'AVAILABLE';
  reason: string;
  adminUid: string;
  adminEmail: string;
}) {
  try {
    const adminUser = await getOrCreateUser(
      params.adminUid,
      params.adminEmail,
      'Venue Director',
      'ADMIN'
    );
    const staticSeats = await getStaticStadiumSeats();
    const seatMetaMap = new Map(staticSeats.map((s) => [s.id, s]));

    const currentRows = await db
      .select()
      .from(seatInventory)
      .where(
        and(
          eq(seatInventory.matchId, params.matchId),
          inArray(seatInventory.seatId, params.seatIds)
        )
      );

    const eligibleIds: number[] = [];
    const skippedSeatCodes: string[] = [];

    for (const r of currentRows) {
      if (r.status === 'BOOKED' || r.status === 'HELD') {
        skippedSeatCodes.push(`${seatMetaMap.get(r.seatId)?.seatCode || r.seatId} (${r.status})`);
      } else {
        eligibleIds.push(r.seatId);
      }
    }

    if (eligibleIds.length > 0) {
      await db
        .update(seatInventory)
        .set({
          status: params.targetStatus,
          holdUserId: null,
          holdToken: null,
          holdExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(seatInventory.matchId, params.matchId),
            inArray(seatInventory.seatId, eligibleIds)
          )
        );

      await db.insert(auditLogs).values({
        actorUserId: adminUser.id,
        actorRole: 'ADMIN',
        action: params.targetStatus === 'BLOCKED' ? 'SEATS_BLOCKED' : 'SEATS_UNBLOCKED',
        entityType: 'SEAT_INVENTORY',
        entityId: `match:${params.matchId}`,
        metadataJson: JSON.stringify({
          seatIds: eligibleIds,
          skippedProtectedSeats: skippedSeatCodes,
          reason: params.reason,
        }),
      });
    }

    return {
      matchId: params.matchId,
      seatIds: eligibleIds,
      skippedSeatCodes,
      status: params.targetStatus,
      instanceIndices: eligibleIds.map((id) => seatMetaMap.get(id)?.instanceIndex ?? 0),
    };
  } catch (error) {
    console.error('Failed to toggle seat block state:', error);
    throw new Error('Failed to update seat status.', { cause: error });
  }
}

export async function getAdminBlockSeats(matchId: number, blockCode: string) {
  await ensureStadiumSeeded();
  const staticSeats = await getStaticStadiumSeats();
  const blockSeats = staticSeats.filter((s) => s.blockCode === blockCode);
  if (blockSeats.length === 0) return [];
  const seatIds = blockSeats.map((s) => s.id);
  const invRows = await db
    .select()
    .from(seatInventory)
    .where(and(eq(seatInventory.matchId, matchId), inArray(seatInventory.seatId, seatIds)));
  const invMap = new Map(invRows.map((r) => [r.seatId, r]));

  return blockSeats.map((s) => ({
    id: s.id,
    seatCode: s.seatCode,
    rowNumber: s.rowNumber,
    seatNumber: s.seatNumber,
    categoryName: s.categoryName,
    status: invMap.get(s.id)?.status ?? 'AVAILABLE',
    bookingId: invMap.get(s.id)?.bookingId ?? null,
  }));
}

export async function listAdminBookings(params: {
  matchId?: number;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  await ensureStadiumSeeded();
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.max(5, Math.min(50, params.pageSize || 12));

  const allBookings = params.matchId
    ? await db
        .select()
        .from(bookings)
        .where(eq(bookings.matchId, params.matchId))
        .orderBy(desc(bookings.createdAt))
    : await db.select().from(bookings).orderBy(desc(bookings.createdAt));

  const [allUsers, allMatches, allPayments, allTickets] = await Promise.all([
    db.select().from(users),
    db.select().from(matches),
    db.select({
      bookingId: payments.bookingId,
      razorpayOrderId: payments.razorpayOrderId,
      razorpayPaymentId: payments.razorpayPaymentId,
      status: payments.status,
      amountPaise: payments.amountPaise,
    }).from(payments),
    db.select({
      bookingId: tickets.bookingId,
      ticketCode: tickets.ticketCode,
      seatId: tickets.seatId,
      status: tickets.status,
      scannedAt: tickets.scannedAt,
    }).from(tickets),
  ]);

  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  const matchMap = new Map(allMatches.map((m) => [m.id, m]));
  const payMap = new Map(allPayments.map((p) => [p.bookingId, p]));
  const ticketsByBooking = new Map<number, typeof allTickets>();
  for (const t of allTickets) {
    const arr = ticketsByBooking.get(t.bookingId) ?? [];
    arr.push(t);
    ticketsByBooking.set(t.bookingId, arr);
  }
  const staticSeats = await getStaticStadiumSeats();
  const seatMap = new Map(staticSeats.map((s) => [s.id, s]));

  const q = (params.search || '').trim().toLowerCase();
  const statusFilter = (params.status || 'ALL').toUpperCase();

  const hydrated = allBookings
    .map((b) => {
      const u = userMap.get(b.userId);
      const m = matchMap.get(b.matchId);
      const p = payMap.get(b.id);
      const bTix = ticketsByBooking.get(b.id) ?? [];
      const usedCount = bTix.filter((t) => t.status === 'USED').length;
      return {
        id: b.id,
        bookingReference: b.bookingReference,
        matchId: b.matchId,
        matchTitle: m?.title ?? `Match #${b.matchId}`,
        matchStartTime: m?.startTime ?? null,
        userName: u?.name ?? 'Fan',
        userEmail: u?.email ?? '',
        status: b.status,
        seatCount: b.seatCount,
        totalAmountPaise: b.totalAmountPaise,
        refundAmountPaise: b.refundAmountPaise,
        paymentStatus: p?.status ?? 'CREATED',
        razorpayOrderId: p?.razorpayOrderId ?? '',
        razorpayPaymentId: p?.razorpayPaymentId ?? null,
        ticketsTotal: bTix.length,
        ticketsUsed: usedCount,
        tickets: bTix.map((t) => ({
          ticketCode: t.ticketCode,
          seatCode: seatMap.get(t.seatId)?.seatCode ?? '',
          standName: seatMap.get(t.seatId)?.standName ?? '',
          status: t.status,
          scannedAt: t.scannedAt,
        })),
        createdAt: b.createdAt,
      };
    })
    .filter((row) => {
      if (statusFilter !== 'ALL' && row.status !== statusFilter) return false;
      if (q) {
        const hay = `${row.bookingReference} ${row.userName} ${row.userEmail} ${row.matchTitle} ${row.razorpayOrderId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

  const totalCount = hydrated.length;
  const start = (page - 1) * pageSize;
  return {
    bookings: hydrated.slice(start, start + pageSize),
    totalCount,
    page,
    pageSize,
  };
}

export async function listAdminAuditLogs(limit = 50) {
  await ensureStadiumSeeded();
  const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
  const allUsers = await db.select().from(users);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));
  return logs.map((l) => ({
    ...l,
    actorEmail: l.actorUserId ? userMap.get(l.actorUserId)?.email ?? null : null,
  }));
}
