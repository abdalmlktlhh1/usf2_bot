import { db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { visitorStats } from '../schema.js';

const ACTIVE_WINDOW_MS = 90 * 1000;
export default async function (input = {}) {
  const now = Date.now();
  const id = typeof input.visitorId === 'string' ? input.visitorId.trim().slice(0, 80) : '';
  if (id && /^[a-zA-Z0-9_-]{12,80}$/.test(id)) {
    const existing = await db.select().from(visitorStats).where(eq(visitorStats.visitorId, id)).get();
    if (existing) {
      await db.update(visitorStats).set({ lastSeen: now, visitCount: Number(existing.visitCount || 0) + (now - Number(existing.lastSeen || 0) > ACTIVE_WINDOW_MS ? 1 : 0) }).where(eq(visitorStats.visitorId, id)).run();
    } else {
      await db.insert(visitorStats).values({ visitorId: id, firstSeen: now, lastSeen: now, visitCount: 1 }).onConflictDoNothing();
    }
  }
  // Keep the heartbeat endpoint focused on one session. Aggregated visitor
  // counts are loaded only when the owner opens the analytics dashboard.
  return { updated: Boolean(id), updatedAt: now };
}
