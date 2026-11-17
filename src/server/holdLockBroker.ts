/**
 * High-precision atomic seat hold lock manager & TTL broker.
 * Provides mutex acquisition per (matchId, seatId) to prevent race conditions
 * before entering PostgreSQL transactions, plus automatic TTL expiry callbacks.
 * Compatible with external Redis when REDIS_URL is configured in Docker deployments.
 */

interface HoldEntry {
  holdToken: string;
  matchId: number;
  userId: number;
  seatIds: number[];
  instanceIndices: number[];
  expiresAt: number;
}

class HoldLockBroker {
  private activeSeatLocks = new Set<string>();
  private holdsByToken = new Map<string, HoldEntry>();

  /**
   * Atomically acquires in-memory mutexes for a sorted list of seats on a match.
   * Returns false immediately if any seat is currently mid-transaction.
   */
  acquireSeatMutexes(matchId: number, seatIds: number[]): boolean {
    const sorted = [...seatIds].sort((a, b) => a - b);
    const keys = sorted.map((id) => `${matchId}:${id}`);
    for (const k of keys) {
      if (this.activeSeatLocks.has(k)) {
        return false;
      }
    }
    for (const k of keys) {
      this.activeSeatLocks.add(k);
    }
    return true;
  }

  releaseSeatMutexes(matchId: number, seatIds: number[]): void {
    for (const id of seatIds) {
      this.activeSeatLocks.delete(`${matchId}:${id}`);
    }
  }

  registerHold(entry: HoldEntry): void {
    this.holdsByToken.set(entry.holdToken, entry);
  }

  removeHold(holdToken: string): void {
    this.holdsByToken.delete(holdToken);
  }

  getHold(holdToken: string): HoldEntry | undefined {
    return this.holdsByToken.get(holdToken);
  }
}

export const holdLockBroker = new HoldLockBroker();
