import { db } from 'sdk';
import { eq } from 'sdk/db';
import { moderators } from '../schema.js';

const OWNER_ID = 5187563344;

export async function isAdminUser(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  if (id === OWNER_ID) return true;
  const moderator = await db.select().from(moderators).where(eq(moderators.telegramId, id)).get();
  return Boolean(moderator?.isActive);
}
