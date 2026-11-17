import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { adminAuth } from '../lib/firebase-admin.ts';
import { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN' | 'GATE_STAFF';
}

export interface AuthRequest extends Request {
  user?: AuthenticatedUser;
  firebaseToken?: DecodedIdToken;
}

const JWT_SECRET = process.env.JWT_SECRET || 'stadiumx-jwt-secret-key-change-in-prod';

export function signSessionToken(user: AuthenticatedUser): string {
  const payload = {
    ...user,
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
      role: parsed.role || 'USER',
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
    // Provide seamless default demo session if X-Demo-Role header is present or fallback to fan account
    const demoRoleHeader = req.headers['x-stadiumx-role'] as string | undefined;
    const role: AuthenticatedUser['role'] =
      demoRoleHeader === 'ADMIN' || demoRoleHeader === 'GATE_STAFF' ? demoRoleHeader : 'USER';
    const rawVisitor = req.headers['x-stadiumx-visitor'];
    const visitorId =
      typeof rawVisitor === 'string' && /^[a-zA-Z0-9_-]{3,40}$/.test(rawVisitor)
        ? rawVisitor
        : null;

    if (role === 'USER' && visitorId) {
      req.user = {
        uid: `visitor-${visitorId}`,
        email: `${visitorId}@guest.stadiumx.in`,
        name: `Fan (${visitorId})`,
        role: 'USER',
      };
      return next();
    }

    req.user = {
      uid: role === 'ADMIN' ? 'demo-admin-uid' : role === 'GATE_STAFF' ? 'demo-gate-uid' : 'demo-fan-uid',
      email:
        role === 'ADMIN'
          ? 'admin@stadiumx.in'
          : role === 'GATE_STAFF'
          ? 'gate@stadiumx.in'
          : 'fan@stadiumx.in',
      name:
        role === 'ADMIN'
          ? 'Vikram Rathore (Venue Director)'
          : role === 'GATE_STAFF'
          ? 'Suresh Nair (Gate 1 Turnstile)'
          : 'Aarav Mehta',
      role,
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
    const roleHeader = req.headers['x-stadiumx-role'] as string | undefined;
    const role: AuthenticatedUser['role'] =
      roleHeader === 'ADMIN' || roleHeader === 'GATE_STAFF' ? roleHeader : 'USER';
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email || `${decodedToken.uid}@stadiumx.in`,
      name: decodedToken.name || decodedToken.email?.split('@')[0] || 'StadiumX Member',
      role,
    };
    return next();
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const requireRole = (allowedRoles: Array<'USER' | 'ADMIN' | 'GATE_STAFF'>) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Forbidden: Requires role ${allowedRoles.join(' or ')} (current: ${req.user.role})`,
      });
    }
    next();
  };
};
