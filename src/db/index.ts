import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const isDatabaseConfigured = (): boolean =>
  Boolean(
    process.env.DATABASE_URL ||
      (process.env.SQL_HOST && process.env.SQL_DB_NAME)
  );

function shouldUseSsl(connectionString?: string, host?: string): boolean | { rejectUnauthorized: boolean } {
  if (process.env.SQL_SSL === 'false' || process.env.PGSSLMODE === 'disable') {
    return false;
  }
  if (process.env.SQL_SSL === 'true' || process.env.PGSSLMODE === 'require') {
    return { rejectUnauthorized: false };
  }
  if (host?.startsWith('/cloudsql') || host === 'localhost' || host === '127.0.0.1') {
    return false;
  }
  if (connectionString) {
    if (connectionString.includes('sslmode=disable')) return false;
    if (
      connectionString.includes('localhost') ||
      connectionString.includes('127.0.0.1') ||
      connectionString.includes('/cloudsql')
    ) {
      return false;
    }
    return { rejectUnauthorized: false };
  }
  return false;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const databaseUrl = process.env.DATABASE_URL;
    const poolConfig: PoolConfig = databaseUrl
      ? {
          connectionString: databaseUrl,
          max: 10,
          connectionTimeoutMillis: 15000,
          ssl: shouldUseSsl(databaseUrl),
        }
      : {
          host: process.env.SQL_HOST,
          port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : undefined,
          user: process.env.SQL_USER,
          password: process.env.SQL_PASSWORD,
          database: process.env.SQL_DB_NAME,
          max: 10,
          connectionTimeoutMillis: isDatabaseConfigured() ? 15000 : 2000,
          ssl: shouldUseSsl(undefined, process.env.SQL_HOST),
        };

    global._postgresPool = new Pool(poolConfig);

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export async function checkDatabaseHealth(): Promise<{
  configured: boolean;
  connected: boolean;
}> {
  const configured = isDatabaseConfigured();
  if (!configured) {
    return { configured: false, connected: false };
  }
  try {
    await pool.query('SELECT 1');
    return { configured: true, connected: true };
  } catch {
    return { configured: true, connected: false };
  }
}

export const db = drizzle(pool, { schema });
export { pool };
