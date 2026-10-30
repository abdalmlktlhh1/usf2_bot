import { db } from 'sdk';
import { eq } from 'sdk/db';
import { visitorStats } from '../schema.js';

const ACTIVE_WINDOW_MS = 90 * 1000;
function cleanText(value, limit = 120) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

export default async function (input = {}, ctx) {
  const now = Date.now();
  // Telegram is the identity source for visitors. Never create an anonymous visitor
  // row when verified Telegram Mini App data is unavailable.
  const telegramUser = ctx?.initData?.user;
  const telegramIdValue = Number(telegramUser?.id);
  const telegramId = Number.isSafeInteger(telegramIdValue) && telegramIdValue > 0 ? telegramIdValue : null;
  if (!telegramId) return { updated: false, reason: 'telegram_identity_unavailable', updatedAt: now };

  // Canonical identity: one row per Telegram account across browsers/devices.
  const id = `tg_${telegramId}`;
  const existing = await db.select().from(visitorStats).where(eq(visitorStats.visitorId, id)).get();
  const telegramUsername = cleanText(telegramUser?.username, 64) || null;
  const telegramName = [cleanText(telegramUser?.first_name, 60), cleanText(telegramUser?.last_name, 60)].filter(Boolean).join(' ').slice(0, 120) || null;
  const submittedUsername = cleanText(input.accountUsername, 64);
  const accountUsername = submittedUsername || existing?.accountUsername || null;
  const accountSessionActive = Boolean(submittedUsername);
  const displayName = cleanText(input.displayName, 120) || existing?.displayName || telegramName;
  const identity = { accountUsername, displayName, accountSessionActive, telegramId, telegramUsername, telegramName };

  if (existing) {
    const lastSeen = Number(existing.lastSeen || 0);
    await db.update(visitorStats).set({
      lastSeen: now,
      visitCount: Number(existing.visitCount || 0) + (now - lastSeen > ACTIVE_WINDOW_MS ? 1 : 0),
      ...identity,
    }).where(eq(visitorStats.visitorId, id)).run();
  } else {
    await db.insert(visitorStats).values({
      visitorId: id, firstSeen: now, lastSeen: now, visitCount: 1, ...identity,
    }).onConflictDoNothing();
  }
  return { updated: true, updatedAt: now, visitorKey: id };
}
