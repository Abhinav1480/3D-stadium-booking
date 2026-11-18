import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { Server as SocketIOServer } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import QRCode from 'qrcode';
import {
  requireAuth,
  signSessionToken,
  type AuthRequest,
} from './src/middleware/auth.ts';
import { checkDatabaseHealth, isDatabaseConfigured } from './src/db/index.ts';
import {
  cancelBookingAndRefund,
  confirmPaymentAndIssueTickets,
  createCheckoutOrder,
  getMatchInventorySnapshot,
  getOrCreateUser,
  getStadiumBundle,
  getStaticStadiumSeats,
  incrementSeatViewCount,
  listMatchesWithStats,
  listUserBookings,
  placeAtomicSeatHold,
  releaseSeatHold,
  sweepExpiredHolds,
} from './src/db/repository.ts';
import {
  DEFAULT_STADIUM_SPEC,
  computeSeatViewTelemetry,
  recommendSeats,
  type SeatWithInventory,
} from './src/shared/stadiumSpec.ts';
import { buildDeterministicStaticStadiumBundle } from './src/shared/staticStadiumFallback.ts';
import { computeRazorpaySignature } from './src/shared/security.ts';

function buildCorsOriginMatcher() {
  const raw = [
    process.env.CORS_ORIGINS,
    process.env.ALLOWED_ORIGINS,
    process.env.APP_URL,
  ]
    .filter(Boolean)
    .join(',');

  const entries = raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const allowAll = entries.includes('*');

  return (origin?: string | null): boolean => {
    if (!origin) return true;
    if (allowAll) return true;
    const normalized = origin.replace(/\/+$/, '');
    if (entries.includes(normalized)) return true;

    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.endsWith('.vercel.app') ||
        host.endsWith('.run.app')
      ) {
        return true;
      }
      for (const entry of entries) {
        if (entry.startsWith('*.')) {
          const suffix = entry.slice(1).toLowerCase();
          if (host.endsWith(suffix)) return true;
        }
      }
    } catch {
      return false;
    }

    return entries.length === 0;
  };
}

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  const httpServer = createServer(app);
  const isOriginAllowed = buildCorsOriginMatcher();

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (isOriginAllowed(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Origin not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
  });

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isOriginAllowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT, PATCH, DELETE, OPTIONS'
      );
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, x-stadiumx-visitor'
      );
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
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
    if (!isDatabaseConfigured()) return;
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

  // Health Check (includes PostgreSQL readiness status)
  app.get('/api/health', async (_req, res) => {
    const database = await checkDatabaseHealth();
    res.json({
      status: 'ok',
      service: 'STADIUMX-ENGINE',
      database,
      timestamp: new Date().toISOString(),
    });
  });

  const requireDatabase = (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (!isDatabaseConfigured()) {
      return res.status(503).json({
        error:
          'PostgreSQL database is not configured on the backend server (set DATABASE_URL or SQL_HOST/SQL_DB_NAME).',
      });
    }
    next();
  };

  // Customer Session Endpoint
  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const buildStatelessAuthResponse = () => {
      const fallbackUser = {
        uid: req.user!.uid,
        email: req.user!.email,
        name: req.user!.name,
        role: 'USER' as const,
      };
      const token = signSessionToken(fallbackUser);
      return { user: fallbackUser, token };
    };

    if (!isDatabaseConfigured()) {
      return res.json(buildStatelessAuthResponse());
    }

    try {
      const dbUser = await getOrCreateUser(
        req.user.uid,
        req.user.email,
        req.user.name
      );
      const token = signSessionToken({
        uid: dbUser.uid,
        email: dbUser.email,
        name: dbUser.name,
        role: 'USER',
      });
      res.json({ user: dbUser, token });
    } catch {
      res.json(buildStatelessAuthResponse());
    }
  });

  // Stadium Specification & Seats
  app.get('/api/stadium', async (_req, res) => {
    const getFallbackStadium = () => {
      const b = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC);
      return {
        stadium: b.stadium,
        categories: b.categories,
        stands: b.stands,
        blocks: b.blocks,
      };
    };

    if (!isDatabaseConfigured()) {
      return res.json(getFallbackStadium());
    }

    try {
      const bundle = await getStadiumBundle();
      res.json(bundle);
    } catch {
      res.json(getFallbackStadium());
    }
  });

  let cachedSeatsJsonBuf: Buffer | null = null;
  let cachedSeatsGzipBuf: Buffer | null = null;

  app.get('/api/stadium/seats', async (req, res) => {
    try {
      if (!cachedSeatsJsonBuf) {
        let staticSeats: unknown[];
        if (isDatabaseConfigured()) {
          try {
            staticSeats = await getStaticStadiumSeats();
          } catch {
            staticSeats = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).seats;
          }
        } else {
          staticSeats = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).seats;
        }
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

      let staticSeats;
      if (isDatabaseConfigured()) {
        try {
          staticSeats = await getStaticStadiumSeats();
        } catch {
          staticSeats = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).seats;
        }
      } else {
        staticSeats = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).seats;
      }

      const seat = staticSeats.find((s) => s.id === seatId);
      if (!seat) {
        return res.status(404).json({ error: 'Seat not found' });
      }

      if (matchId && isDatabaseConfigured()) {
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
    if (!isDatabaseConfigured()) {
      return res.json({
        matches: buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).defaultMatches,
      });
    }
    try {
      const list = await listMatchesWithStats();
      res.json({ matches: list });
    } catch {
      res.json({
        matches: buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).defaultMatches,
      });
    }
  });

  app.get('/api/matches/:matchId/inventory', async (req, res) => {
    const matchId = Number(req.params.matchId);
    if (!isDatabaseConfigured()) {
      return res.json(
        buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).getMatchInventorySnapshot(
          matchId
        )
      );
    }
    try {
      const snapshot = await getMatchInventorySnapshot(matchId);
      res.json(snapshot);
    } catch {
      res.json(
        buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).getMatchInventorySnapshot(
          matchId
        )
      );
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

      let staticSeats;
      let snapshot: {
        inventory: Array<{ seatId: number; status: string; holdExpiresAt?: Date | string | null }>;
        pricing: Array<{ categoryId: number; finalPricePaise: number }>;
      };

      if (isDatabaseConfigured()) {
        try {
          [staticSeats, snapshot] = await Promise.all([
            getStaticStadiumSeats(),
            getMatchInventorySnapshot(matchId),
          ]);
        } catch {
          const fallback = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC);
          staticSeats = fallback.seats;
          snapshot = fallback.getMatchInventorySnapshot(matchId);
        }
      } else {
        const fallback = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC);
        staticSeats = fallback.seats;
        snapshot = fallback.getMatchInventorySnapshot(matchId);
      }

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
    requireDatabase,
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
    requireDatabase,
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
    requireDatabase,
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
    requireDatabase,
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
          userUid: req.user!.uid,
          userEmail: req.user!.email,
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
  app.get('/api/bookings/my', requireDatabase, requireAuth, async (req: AuthRequest, res) => {
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

  app.post('/api/bookings/:bookingId/cancel', requireDatabase, requireAuth, async (req: AuthRequest, res) => {
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
      let staticSeats;
      if (isDatabaseConfigured()) {
        try {
          staticSeats = await getStaticStadiumSeats();
        } catch {
          staticSeats = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).seats;
        }
      } else {
        staticSeats = buildDeterministicStaticStadiumBundle(DEFAULT_STADIUM_SPEC).seats;
      }
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

  // Always return JSON 404 for unknown /api/* routes instead of HTML fallback
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  // Mount Vite dev server or production static bundle (if dist/ is present)
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ...(process.env.DISABLE_HMR === 'true' ? { hmr: false } : {}),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    const distIndexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(distIndexPath)) {
      app.use(express.static(distPath, { maxAge: '1d' }));
      app.get('*', (_req, res) => {
        res.sendFile(distIndexPath);
      });
    } else {
      app.get('/', async (_req, res) => {
        const database = await checkDatabaseHealth();
        res.json({
          status: 'ok',
          service: 'STADIUMX-ENGINE',
          mode: 'api-only',
          database,
        });
      });
    }
  }

  const readCliArg = (flag: string): string | undefined => {
    const eqPrefix = `${flag}=`;
    for (let i = 2; i < process.argv.length; i++) {
      const arg = process.argv[i];
      if (arg === flag && i + 1 < process.argv.length) {
        return process.argv[i + 1];
      }
      if (arg.startsWith(eqPrefix)) {
        return arg.slice(eqPrefix.length);
      }
    }
    return undefined;
  };

  const cliPort = Number(readCliArg('--port'));
  const PORT =
    Number.isFinite(cliPort) && cliPort > 0
      ? cliPort
      : Number(process.env.PORT) || 3000;
  const HOST = readCliArg('--host') || '0.0.0.0';

  httpServer.listen(PORT, HOST, () => {
    console.log(`STADIUMX Full-Stack Server & Socket.IO listening on http://${HOST}:${PORT}`);
  });
}

startServer();
