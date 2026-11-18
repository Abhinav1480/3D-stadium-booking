export interface LocationLike {
  protocol?: string;
  hostname?: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function isLocalHostname(hostname?: string): boolean {
  if (!hostname) return false;
  return LOCAL_HOSTS.has(hostname.toLowerCase());
}

function extractUrlHostname(urlStr: string): string | null {
  try {
    return new URL(urlStr).hostname;
  } catch {
    return null;
  }
}

/**
 * Resolves the API base URL cleanly across local dev, AI Studio preview, and Vercel production.
 * - Returns '' (same-origin) when no external backend URL is configured.
 * - Rejects accidentally baked localhost URLs when running on a non-local HTTPS origin.
 */
export function resolveApiBaseUrl(
  rawEnvUrl?: string | null,
  loc?: LocationLike | null
): string {
  const trimmed = (rawEnvUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';

  const targetHost = extractUrlHostname(trimmed);
  const currentHost = loc?.hostname;
  if (
    targetHost &&
    isLocalHostname(targetHost) &&
    currentHost &&
    !isLocalHostname(currentHost)
  ) {
    return '';
  }

  return trimmed;
}

export function getApiBaseUrl(): string {
  const envUrl =
    typeof import.meta !== 'undefined' && (import.meta as any).env
      ? ((import.meta as any).env.VITE_API_BASE_URL as string | undefined)
      : undefined;
  const loc = typeof window !== 'undefined' ? window.location : null;
  return resolveApiBaseUrl(envUrl, loc);
}

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function getSocketBaseUrl(): string | undefined {
  const base = getApiBaseUrl();
  return base || undefined;
}

export function getVisitorId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage?.getItem('stadiumx_visitor_id') || null;
  } catch {
    return null;
  }
}

export function buildAuthHeaders(
  sessionToken?: string | null,
  extraHeaders?: Record<string, string>
): Record<string, string> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }
  const visitorId = getVisitorId();
  if (visitorId) {
    headers['x-stadiumx-visitor'] = visitorId;
  }
  return headers;
}

export class BackendUnavailableError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 503) {
    super(message);
    this.name = 'BackendUnavailableError';
    this.statusCode = statusCode;
  }
}

export async function parseJsonResponse<T = any>(
  res: Response
): Promise<{ isJson: boolean; data: T | null }> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return { isJson: false, data: null };
  }
  const data = (await res.json()) as T;
  return { isJson: true, data };
}
