import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import QRCode from 'qrcode';
import {
  requireAuth,
  requireRole,
  signSessionToken,
  type AuthRequest,
} from './src/middleware/auth.ts';
import {
  adminSetSeatBlockState,
  cancelBookingAndRefund,
  confirmPaymentAndIssueTickets,
  createAdminMatch,
  createCheckoutOrder,
  getAdminAnalytics,
  getAdminBlockSeats,
  getAdminReferenceData,
  getGateScanLogs,
  getGateTurnstilePasses,
  getMatchInventorySnapshot,
  getOrCreateUser,
  getStadiumBundle,
  getStaticStadiumSeats,
  incrementSeatViewCount,
  listAdminAuditLogs,
  listAdminBookings,
  listMatchesWithStats,
  listUserBookings,
  placeAtomicSeatHold,
  releaseSeatHold,
  sweepExpiredHolds,
  updateAdminMatch,
  updateMatchDynamicMultipliers,
  validateGateQrToken,
} from './src/db/repository.ts';
import {
  DEFAULT_STADIUM_SPEC,
  computeSeatViewTelemetry,
  recommendSeats,
  type SeatWithInventory,
} from './src/shared/stadiumSpec.ts';
import { computeRazorpaySignature } from './src/shared/security.ts';

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    },
  });

  app.use(express.json({ limit: '2mb' }));

  // Simple in-memory rate limiter for hold & checkout endpoints
  const rateLimitWindowMs = 15_000;
  const requestCounts = new Map<string, { count: number; resetAt: number }>();
  const rateLimitMiddleware = (maxReqs: number) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const ip = req.ip || 'local';
      const now = Date.now();
      const entry = requestCounts.get(ip);
      if (!entry || now > entry.resetAt) {
        requestCounts.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
        return next();
      }
      entry.count++;
      if (entry.count > maxReqs) {
        return res.status(429).json({
          error: 'Too many requests. Please wait a few seconds before trying again.',
        });
      }
      return next();
    };
  };

  // Real-Time Socket.IO rooms per match
  io.on('connection', (socket) => {
    socket.on('match:join', (matchId: number) => {
      const room = `match:${matchId}`;
      socket.join(room);
    });

    socket.on('match:leave', (matchId: number) => {
      const room = `match:${matchId}`;
      socket.leave(room);
    });
  });

  // Periodic background sweep for expired seat holds every 5 seconds
  setInterval(async () => {
    try {
      const expiredBatches = await sweepExpiredHolds();
      for (const batch of expiredBatches) {
        io.to(`match:${batch.matchId}`).emit('seat:updated', {
          matchId: batch.matchId,
          seatIds: batch.seatIds,
          instanceIndices: batch.instanceIndices,
          status: 'AVAILABLE',
          holdExpiresAt: null,
        });
      }
    } catch {
      // Ignore transient sweep errors
    }
  }, 5000);

  // Health Check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'STADIUMX-ENGINE',
      timestamp: new Date().toISOString(),
    });
  });

  // Auth & Role Switching Endpoints
  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      const dbUser = await getOrCreateUser(
        req.user.uid,
        req.user.email,
        req.user.name,
        req.user.role
      );
      const token = signSessionToken({
        uid: dbUser.uid,
        email: dbUser.email,
        name: dbUser.name,
        role: dbUser.role as 'USER' | 'ADMIN' | 'GATE_STAFF',
      });
      res.json({ user: dbUser, token });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load profile' });
    }
  });

  const SwitchRoleSchema = z.object({
    role: z.enum(['USER', 'ADMIN', 'GATE_STAFF']),
  });

  app.post('/api/auth/switch-role', requireAuth, async (req: AuthRequest, res) => {
    try {
      const parsed = SwitchRoleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid role specified' });
      }
      const { role } = parsed.data;
      const roleUserMap = {
        USER: {
          uid: 'demo-fan-uid',
          email: 'fan@stadiumx.in',
          name: 'Aarav Mehta',
        },
        ADMIN: {
          uid: 'demo-admin-uid',
          email: 'admin@stadiumx.in',
          name: 'Vikram Rathore (Venue Director)',
        },
        GATE_STAFF: {
          uid: 'demo-gate-uid',
          email: 'gate@stadiumx.in',
          name: 'Suresh Nair (Gate 1 Turnstile)',
        },
      };
      const target = roleUserMap[role];
      const dbUser = await getOrCreateUser(target.uid, target.email, target.name, role);
      const token = signSessionToken({
        uid: dbUser.uid,
        email: dbUser.email,
        name: dbUser.name,
        role,
      });
      res.json({ user: dbUser, token });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to switch role' });
    }
  });

  // Stadium Specification & Seats
  app.get('/api/stadium', async (_req, res) => {
    try {
      const bundle = await getStadiumBundle();
      res.json(bundle);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load stadium' });
    }
  });

  let cachedSeatsJsonBuf: Buffer | null = null;
  let cachedSeatsGzipBuf: Buffer | null = null;

  app.get('/api/stadium/seats', async (req, res) => {
    try {
      if (!cachedSeatsJsonBuf) {
        const staticSeats = await getStaticStadiumSeats();
        cachedSeatsJsonBuf = Buffer.from(JSON.stringify({ seats: staticSeats }));
        cachedSeatsGzipBuf = gzipSync(cachedSeatsJsonBuf, { level: 6 });
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=300');
      const acceptEnc = String(req.headers['accept-encoding'] || '');
      if (acceptEnc.includes('gzip') && cachedSeatsGzipBuf) {
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Vary', 'Accept-Encoding');
        return res.send(cachedSeatsGzipBuf);
      }
      return res.send(cachedSeatsJsonBuf);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load seats' });
    }
  });

  app.get('/api/stadium/seats/:seatId/telemetry', async (req, res) => {
    try {
      const seatId = Number(req.params.seatId);
      const timeOfDay = req.query.timeOfDay ? Number(req.query.timeOfDay) : 15.5;
      const matchId = req.query.matchId ? Number(req.query.matchId) : 1;

      const staticSeats = await getStaticStadiumSeats();
      const seat = staticSeats.find((s) => s.id === seatId);
      if (!seat) {
        return res.status(404).json({ error: 'Seat not found' });
      }

      if (matchId) {
        await incrementSeatViewCount(matchId, seatId);
      }

      const telemetry = computeSeatViewTelemetry(
        seat,
        timeOfDay,
        DEFAULT_STADIUM_SPEC
      );

      res.json({ seat, telemetry });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to compute seat telemetry' });
    }
  });

  // Matches & Inventory
  app.get('/api/matches', async (_req, res) => {
    try {
      const list = await listMatchesWithStats();
      res.json({ matches: list });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load matches' });
    }
  });

  app.get('/api/matches/:matchId/inventory', async (req, res) => {
    try {
      const matchId = Number(req.params.matchId);
      const snapshot = await getMatchInventorySnapshot(matchId);
      res.json(snapshot);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load match inventory' });
    }
  });

  // Smart Seat Recommendations
  const RecommendationSchema = z.object({
    budgetPerSeatPaise: z.number().min(0).default(500000),
    groupSize: z.number().int().min(1).max(6).default(2),
    preferredCategoryCode: z.string().optional(),
    preferredStandCode: z.string().optional(),
    preferBestView: z.boolean().optional(),
    preferShade: z.boolean().default(true),
    preferStraightView: z.boolean().default(true),
    preferCloseToPitch: z.boolean().default(false),
    preferBestElevation: z.boolean().optional(),
    preferNearEntrance: z.boolean().optional(),
    preferFamilyZone: z.boolean().default(false),
    requireAdjacentSeats: z.boolean().optional(),
    sortBy: z
      .enum(['MATCH_SCORE', 'PRICE_ASC', 'VIEW_SCORE', 'CLOSEST_PITCH', 'SHADE'])
      .optional(),
  });

  app.post('/api/matches/:matchId/recommendations', async (req, res) => {
    try {
      const matchId = Number(req.params.matchId);
      const parsed = RecommendationSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid recommendation preferences' });
      }

      const [staticSeats, snapshot] = await Promise.all([
        getStaticStadiumSeats(),
        getMatchInventorySnapshot(matchId),
      ]);

      const nowMs = Date.now();
      const statusBySeatId = new Map<number, SeatWithInventory['status']>(
        snapshot.inventory.map((i: any) => {
          let st = i.status as SeatWithInventory['status'];
          if (st === 'HELD' && i.holdExpiresAt && new Date(i.holdExpiresAt).getTime() <= nowMs) {
            st = 'AVAILABLE';
          }
          return [i.seatId, st];
        })
      );
      const priceByCatId = new Map(
        snapshot.pricing.map((p) => [p.categoryId, p.finalPricePaise])
      );

      const enriched: SeatWithInventory[] = staticSeats.map((s) => ({
        ...s,
        standCode: s.standCode as any,
        categoryCode: s.categoryCode as any,
        status: statusBySeatId.get(s.id) || 'AVAILABLE',
        pricePaise: priceByCatId.get(s.categoryId) ?? 180000,
      }));

      const recommendations = recommendSeats(enriched, parsed.data, 8);
      res.json({ recommendations });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to compute recommendations' });
    }
  });

  // Atomic Seat Holds
  const HoldRequestSchema = z.object({
    seatIds: z.array(z.number().int().positive()).min(1).max(6),
  });

  app.post(
    '/api/matches/:matchId/holds',
    rateLimitMiddleware(35),
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const matchId = Number(req.params.matchId);
        const parsed = HoldRequestSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({
            error: 'Invalid hold request: select between 1 and 6 valid seats.',
          });
        }

        const holdResult = await placeAtomicSeatHold({
          matchId,
          seatIds: parsed.data.seatIds,
          userUid: req.user!.uid,
          userEmail: req.user!.email,
          userName: req.user!.name,
        });

        io.to(`match:${matchId}`).emit('seat:updated', {
          matchId,
          seatIds: parsed.data.seatIds,
          instanceIndices: holdResult.seats.map((s) => s.instanceIndex),
          status: 'HELD',
          holdUserId: holdResult.userId,
          holdExpiresAt: holdResult.holdExpiresAt,
          holdToken: holdResult.holdToken,
        });

        res.status(201).json(holdResult);
      } catch (error: any) {
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Failed to hold seats' });
      }
    }
  );

  app.delete(
    '/api/matches/:matchId/holds/:holdToken',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const matchId = Number(req.params.matchId);
        const holdToken = req.params.holdToken;
        const released = await releaseSeatHold(matchId, holdToken);

        if (released.releasedSeatIds.length > 0) {
          io.to(`match:${matchId}`).emit('seat:updated', {
            matchId,
            seatIds: released.releasedSeatIds,
            instanceIndices: released.instanceIndices,
            status: 'AVAILABLE',
            holdExpiresAt: null,
          });
        }

        res.json({ released: released.releasedSeatIds });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to release hold' });
      }
    }
  );

  // Checkout & Razorpay Test Payment Flow
  const CheckoutSchema = z.object({
    matchId: z.number().int().positive(),
    holdToken: z.string().min(4),
  });

  app.post(
    '/api/bookings/checkout',
    rateLimitMiddleware(25),
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const parsed = CheckoutSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid checkout payload' });
        }

        const order = await createCheckoutOrder({
          matchId: parsed.data.matchId,
          holdToken: parsed.data.holdToken,
          userUid: req.user!.uid,
          userEmail: req.user!.email,
          userName: req.user!.name,
        });

        res.status(201).json(order);
      } catch (error: any) {
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Checkout failed' });
      }
    }
  );

  const VerifyPaymentSchema = z.object({
    razorpayOrderId: z.string().min(5),
    razorpayPaymentId: z.string().optional(),
    razorpaySignature: z.string().optional(),
    simulateTestSuccess: z.boolean().optional(),
  });

  app.post(
    '/api/payments/verify-test',
    requireAuth,
    async (req: AuthRequest, res) => {
      try {
        const parsed = VerifyPaymentSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid payment verification payload' });
        }

        const { razorpayOrderId } = parsed.data;
        const paymentId =
          parsed.data.razorpayPaymentId || `pay_test_${Date.now().toString(36)}`;
        // In test mode, if simulateTestSuccess is true, compute the valid HMAC signature on the server test gateway
        const signature =
          parsed.data.simulateTestSuccess
            ? computeRazorpaySignature(razorpayOrderId, paymentId)
            : parsed.data.razorpaySignature || '';

        const confirmed = await confirmPaymentAndIssueTickets({
          razorpayOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
        });

        // Generate QR SVG data URLs for each issued ticket
        const ticketsWithQr = await Promise.all(
          confirmed.tickets.map(async (t) => {
            const qrDataUrl = await QRCode.toDataURL(t.qrSignedToken, {
              margin: 1,
              width: 240,
              color: {
                dark: '#0B0F17',
                light: '#FFFFFF',
              },
            });
            return { ...t, qrDataUrl };
          })
        );

        io.to(`match:${confirmed.booking.matchId}`).emit('seat:updated', {
          matchId: confirmed.booking.matchId,
          seatIds: confirmed.seats.map((s) => s.seatId),
          instanceIndices: confirmed.instanceIndices,
          status: 'BOOKED',
          holdExpiresAt: null,
        });

        res.json({
          ...confirmed,
          tickets: ticketsWithQr,
        });
      } catch (error: any) {
        const status = error.statusCode || 500;
        res.status(status).json({ error: error.message || 'Payment verification failed' });
      }
    }
  );

  // User Bookings & Cancellation
  app.get('/api/bookings/my', requireAuth, async (req: AuthRequest, res) => {
    try {
      const list = await listUserBookings(req.user!.uid, req.user!.email);
      const enriched = await Promise.all(
        list.map(async (item) => {
          const ticketsWithQr = await Promise.all(
            item.tickets.map(async (t) => {
              const qrDataUrl = await QRCode.toDataURL(t.qrSignedToken, {
                margin: 2,
                width: 320,
                errorCorrectionLevel: 'M',
                color: {
                  dark: '#0B0F17',
                  light: '#FFFFFF',
                },
              });
              return { ...t, qrDataUrl };
            })
          );
          return {
            ...item,
            tickets: ticketsWithQr,
          };
        })
      );
      res.json({ bookings: enriched });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Failed to load bookings' });
    }
  });

  app.post('/api/bookings/:bookingId/cancel', requireAuth, async (req: AuthRequest, res) => {
    try {
      const bookingId = Number(req.params.bookingId);
      const cancelled = await cancelBookingAndRefund({
        bookingId,
        userUid: req.user!.uid,
        userEmail: req.user!.email,
      });

      if (cancelled.releasedSeatIds.length > 0) {
        io.to(`match:${cancelled.matchId}`).emit('seat:updated', {
          matchId: cancelled.matchId,
          seatIds: cancelled.releasedSeatIds,
          instanceIndices: cancelled.instanceIndices,
          status: 'AVAILABLE',
          holdExpiresAt: null,
        });
      }

      res.json(cancelled);
    } catch (error: any) {
      res.status(400).json({ error: error.message || 'Failed to cancel booking' });
    }
  });

  // Gate Staff QR Validation & Turnstile Telemetry
  const GateValidateSchema = z
    .object({
      qrToken: z.string().min(5).optional(),
      ticketCode: z.string().min(3).optional(),
      expectedMatchId: z.number().int().positive().optional(),
    })
    .refine((d) => Boolean(d.qrToken || d.ticketCode), {
      message: 'QR token or ticket reference is required',
    });

  app.post(
    '/api/gate/validate-qr',
    requireAuth,
    requireRole(['GATE_STAFF', 'ADMIN']),
    async (req: AuthRequest, res) => {
      try {
        const parsed = GateValidateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'QR token or ticket reference is required' });
        }

        const result = await validateGateQrToken({
          qrToken: parsed.data.qrToken,
          ticketCode: parsed.data.ticketCode,
          expectedMatchId: parsed.data.expectedMatchId,
          staffUid: req.user!.uid,
          staffEmail: req.user!.email,
          staffName: req.user!.name,
          staffRole: req.user!.role === 'ADMIN' ? 'ADMIN' : 'GATE_STAFF',
        });

        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'QR validation failed' });
      }
    }
  );

  app.get(
    '/api/gate/passes',
    requireAuth,
    requireRole(['GATE_STAFF', 'ADMIN']),
    async (req: AuthRequest, res) => {
      try {
        const matchId = req.query.matchId ? Number(req.query.matchId) : undefined;
        const passes = await getGateTurnstilePasses(matchId);
        const withQr = await Promise.all(
          passes.map(async (p) => {
            const qrDataUrl = await QRCode.toDataURL(p.qrSignedToken, {
              margin: 2,
              width: 320,
              errorCorrectionLevel: 'M',
              color: {
                dark: '#0B0F17',
                light: '#FFFFFF',
              },
            });
            return {
              id: p.id,
              ticketCode: p.ticketCode,
              matchId: p.matchId,
              matchTitle: p.matchTitle,
              status: p.status,
              scannedAt: p.scannedAt,
              seatCode: p.seatCode,
              standName: p.standName,
              blockName: p.blockName,
              rowNumber: p.rowNumber,
              seatNumber: p.seatNumber,
              attendeeName: p.attendeeName,
              qrDataUrl,
            };
          })
        );
        res.json({ passes: withQr });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to load gate passes' });
      }
    }
  );

  app.get(
    '/api/gate/scan-logs',
    requireAuth,
    requireRole(['GATE_STAFF', 'ADMIN']),
    async (req: AuthRequest, res) => {
      try {
        const matchId = req.query.matchId ? Number(req.query.matchId) : undefined;
        const logs = await getGateScanLogs(matchId, 30);
        res.json({ scanLogs: logs });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to load scan logs' });
      }
    }
  );

  // Admin Operations & Analytics
  app.get(
    '/api/admin/meta',
    requireAuth,
    requireRole(['ADMIN']),
    async (_req, res) => {
      try {
        const meta = await getAdminReferenceData();
        res.json(meta);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to load admin reference data' });
      }
    }
  );

  app.get(
    '/api/admin/analytics/:matchId',
    requireAuth,
    requireRole(['ADMIN']),
    async (req, res) => {
      try {
        const matchId = Number(req.params.matchId);
        const daysFilter = req.query.days ? Number(req.query.days) : 0;
        const analytics = await getAdminAnalytics(matchId, daysFilter);
        res.json(analytics);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to load admin analytics' });
      }
    }
  );

  const AdminMatchCreateSchema = z.object({
    stadiumId: z.number().int().positive(),
    homeTeamId: z.number().int().positive(),
    awayTeamId: z.number().int().positive(),
    tournament: z.string().min(2).max(120),
    title: z.string().min(3).max(160),
    startTimeIso: z.string().min(8),
    status: z.enum(['UPCOMING', 'LIVE', 'COMPLETED', 'CANCELLED']).default('UPCOMING'),
    demandMultiplier: z.number().min(0.5).max(3.0).default(1.0),
    rivalryMultiplier: z.number().min(0.5).max(3.0).default(1.0),
    weekendMultiplier: z.number().min(0.5).max(3.0).default(1.0),
    categoryBasePrices: z
      .array(
        z.object({
          categoryId: z.number().int().positive(),
          basePricePaise: z.number().int().min(10000).max(50000000),
        })
      )
      .optional(),
  });

  app.post(
    '/api/admin/matches',
    requireAuth,
    requireRole(['ADMIN']),
    async (req: AuthRequest, res) => {
      try {
        const parsed = AdminMatchCreateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid match creation payload' });
        }
        const match = await createAdminMatch({
          ...parsed.data,
          adminUid: req.user!.uid,
          adminEmail: req.user!.email,
        });
        res.status(201).json({ match });
      } catch (error: any) {
        res.status(400).json({ error: error.message || 'Failed to create match' });
      }
    }
  );

  const AdminMatchUpdateSchema = AdminMatchCreateSchema.partial();

  app.patch(
    '/api/admin/matches/:matchId',
    requireAuth,
    requireRole(['ADMIN']),
    async (req: AuthRequest, res) => {
      try {
        const matchId = Number(req.params.matchId);
        const parsed = AdminMatchUpdateSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid match update payload' });
        }
        const match = await updateAdminMatch({
          matchId,
          ...parsed.data,
          adminUid: req.user!.uid,
          adminEmail: req.user!.email,
        });
        res.json({ match });
      } catch (error: any) {
        res.status(400).json({ error: error.message || 'Failed to update match' });
      }
    }
  );

  const UpdateMultipliersSchema = z.object({
    demandMultiplier: z.number().min(0.5).max(3.0),
    rivalryMultiplier: z.number().min(0.5).max(3.0),
    weekendMultiplier: z.number().min(0.5).max(3.0),
    categoryBasePrices: z
      .array(
        z.object({
          categoryId: z.number().int().positive(),
          basePricePaise: z.number().int().min(10000).max(50000000),
        })
      )
      .optional(),
  });

  app.patch(
    '/api/admin/matches/:matchId/pricing',
    requireAuth,
    requireRole(['ADMIN']),
    async (req: AuthRequest, res) => {
      try {
        const matchId = Number(req.params.matchId);
        const parsed = UpdateMultipliersSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Multipliers must be between 0.5x and 3.0x' });
        }

        const updated = await updateMatchDynamicMultipliers({
          matchId,
          ...parsed.data,
          adminUid: req.user!.uid,
          adminEmail: req.user!.email,
        });

        res.json({ match: updated });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to update pricing' });
      }
    }
  );

  app.get(
    '/api/admin/matches/:matchId/blocks/:blockCode/seats',
    requireAuth,
    requireRole(['ADMIN']),
    async (req, res) => {
      try {
        const matchId = Number(req.params.matchId);
        const blockCode = String(req.params.blockCode || '').toUpperCase();
        const seatsList = await getAdminBlockSeats(matchId, blockCode);
        res.json({ seats: seatsList });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to load block seats' });
      }
    }
  );

  const BlockSeatsSchema = z.object({
    seatIds: z.array(z.number().int().positive()).min(1),
    targetStatus: z.enum(['BLOCKED', 'AVAILABLE']),
    reason: z.string().min(2).default('Camera / Operations Platform'),
  });

  app.post(
    '/api/admin/matches/:matchId/block-seats',
    requireAuth,
    requireRole(['ADMIN']),
    async (req: AuthRequest, res) => {
      try {
        const matchId = Number(req.params.matchId);
        const parsed = BlockSeatsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid seat block payload' });
        }

        const result = await adminSetSeatBlockState({
          matchId,
          seatIds: parsed.data.seatIds,
          targetStatus: parsed.data.targetStatus,
          reason: parsed.data.reason,
          adminUid: req.user!.uid,
          adminEmail: req.user!.email,
        });

        if (result.seatIds.length > 0) {
          io.to(`match:${matchId}`).emit('seat:updated', {
            matchId,
            seatIds: result.seatIds,
            instanceIndices: result.instanceIndices,
            status: result.status,
            holdExpiresAt: null,
          });
        }

        res.json(result);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to update seat block state' });
      }
    }
  );

  app.get(
    '/api/admin/bookings',
    requireAuth,
    requireRole(['ADMIN']),
    async (req, res) => {
      try {
        const matchId = req.query.matchId ? Number(req.query.matchId) : undefined;
        const status = req.query.status ? String(req.query.status) : undefined;
        const search = req.query.search ? String(req.query.search) : undefined;
        const page = req.query.page ? Number(req.query.page) : 1;
        const pageSize = req.query.pageSize ? Number(req.query.pageSize) : 12;

        const data = await listAdminBookings({ matchId, status, search, page, pageSize });
        res.json(data);
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to load admin bookings' });
      }
    }
  );

  app.post(
    '/api/admin/bookings/:bookingId/cancel',
    requireAuth,
    requireRole(['ADMIN']),
    async (req: AuthRequest, res) => {
      try {
        const bookingId = Number(req.params.bookingId);
        const cancelled = await cancelBookingAndRefund({
          bookingId,
          userUid: req.user!.uid,
          userEmail: req.user!.email,
        });

        if (cancelled.releasedSeatIds.length > 0) {
          io.to(`match:${cancelled.matchId}`).emit('seat:updated', {
            matchId: cancelled.matchId,
            seatIds: cancelled.releasedSeatIds,
            instanceIndices: cancelled.instanceIndices,
            status: 'AVAILABLE',
            holdExpiresAt: null,
          });
        }

        res.json(cancelled);
      } catch (error: any) {
        res.status(400).json({ error: error.message || 'Failed to cancel booking' });
      }
    }
  );

  app.get(
    '/api/admin/audit-logs',
    requireAuth,
    requireRole(['ADMIN']),
    async (req, res) => {
      try {
        const limit = req.query.limit ? Number(req.query.limit) : 50;
        const logs = await listAdminAuditLogs(limit);
        res.json({ auditLogs: logs });
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to load audit logs' });
      }
    }
  );

  app.get(
    '/api/admin/reports/:matchId/bookings.csv',
    requireAuth,
    requireRole(['ADMIN']),
    async (req, res) => {
      try {
        const matchId = Number(req.params.matchId);
        const analytics = await getAdminAnalytics(matchId);
        const lines = [
          'Stand Code,Stand Name,Total Seats,Booked Seats,Held Seats,Blocked Seats,Occupancy %,Revenue (INR)',
          ...analytics.standOccupancy.map(
            (s) =>
              `${s.standCode},"${s.standName}",${s.total},${s.booked},${s.held},${s.blocked},${s.occupancyPct}%,${(
                s.revenuePaise / 100
              ).toFixed(2)}`
          ),
        ];
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="stadiumx-match-${matchId}-report.csv"`
        );
        res.send(lines.join('\n'));
      } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to export CSV' });
      }
    }
  );

  // Blender GLB Anchor Manifest Validator
  const BlenderValidateSchema = z.object({
    anchors: z.array(
      z.object({
        seatCode: z.string(),
        posX: z.number(),
        posY: z.number(),
        posZ: z.number(),
      })
    ),
  });

  app.post('/api/blender/validate-manifest', async (req, res) => {
    try {
      const parsed = BlenderValidateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid Blender anchor manifest format' });
      }
      const staticSeats = await getStaticStadiumSeats();
      const seatByCode = new Map(staticSeats.map((s) => [s.seatCode, s]));

      const mismatches: Array<{ seatCode: string; reason: string; driftMetres?: number }> = [];
      let matchedCount = 0;

      for (const anchor of parsed.data.anchors) {
        const dbSeat = seatByCode.get(anchor.seatCode);
        if (!dbSeat) {
          mismatches.push({
            seatCode: anchor.seatCode,
            reason: 'Anchor seatCode not found in parametric database',
          });
          continue;
        }
        const drift = Math.hypot(
          anchor.posX - dbSeat.posX,
          anchor.posY - dbSeat.posY,
          anchor.posZ - dbSeat.posZ
        );
        if (drift > 0.05) {
          mismatches.push({
            seatCode: anchor.seatCode,
            reason: `Spatial drift exceeds 5cm tolerance (${drift.toFixed(3)}m)`,
            driftMetres: Number(drift.toFixed(3)),
          });
        } else {
          matchedCount++;
        }
      }

      res.json({
        valid: mismatches.length === 0,
        checkedCount: parsed.data.anchors.length,
        matchedCount,
        mismatches,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Validation failed' });
    }
  });

  // Cache headers for binary 3D models & high-res textures (prevents repeated 4.5MB downloads)
  app.use(['/models', '/textures'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=3600');
    next();
  });

  // Mount Vite dev server or production static bundle
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath, { maxAge: '1d' }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`STADIUMX Full-Stack Server & Socket.IO listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
