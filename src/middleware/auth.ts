import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { adminAuth } from '../lib/firebase-admin.ts';
import { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  name: string;
  role: 'USER';
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  firebaseToken?: DecodedIdToken;
}

const JWT_SECRET = process.env.JWT_SECRET || 'stadiumx-jwt-secret-key-change-in-prod';

export function signSessionToken(user: AuthenticatedUser): string {
  const payload = {
    ...user,
    role: 'USER' as const,
    iat: Date.now(),
    exp: Date.now() + 7 * 24 * 3600 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`STXJWT.${encoded}`)
    .digest('base64url');
  return `STXJWT.${encoded}.${sig}`;
}

export function verifySessionToken(token: string): AuthenticatedUser | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'STXJWT') return null;
  const [, encoded, sig] = parts;
  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`STXJWT.${encoded}`)
    .digest('base64url');
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (parsed.exp && Date.now() > parsed.exp) return null;
    return {
      uid: parsed.uid,
      email: parsed.email,
      name: parsed.name,
      role: 'USER',
    };
  } catch {
    return null;
  }
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const rawVisitor = req.headers['x-stadiumx-visitor'];
    const visitorId =
      typeof rawVisitor === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(rawVisitor)
        ? rawVisitor
        : null;

    if (visitorId) {
      req.user = {
        uid: `visitor-${visitorId}`,
        email: `${visitorId}@guest.stadiumx.in`,
        name: `Fan (${visitorId})`,
        role: 'USER',
      };
      return next();
    }

    req.user = {
      uid: 'demo-fan-uid',
      email: 'fan@stadiumx.in',
      name: 'Aarav Mehta',
      role: 'USER',
    };
    return next();
  }

  const token = authHeader.split('Bearer ')[1];

  // Check if it is our signed session JWT first
  const localUser = verifySessionToken(token);
  if (localUser) {
    req.user = localUser;
    return next();
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.firebaseToken = decodedToken;
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || `${decodedToken.uid}@stadiumx.in`,
      name: decodedToken.name || decodedToken.email?.split('@')[0] || 'StadiumX Member',
      role: 'USER',
    };
    return next();
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
