import { db } from 'sdk';
import { eq } from 'sdk/db';
import { moderators, siteSettings } from '../schema.js';

export const OWNER_ID = 5187563344;
export const MODERATOR_FEATURES = ['quizCorrection', 'assistant', 'modelImport'];

export async function getModeratorFeatures(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return { quizCorrection: false, assistant: false, modelImport: false };
  if (id === OWNER_ID) return { quizCorrection: true, assistant: true, modelImport: true };
  const row = await db.select().from(siteSettings).where(eq(siteSettings.key, 'moderator_features:' + id)).get();
  const value = row?.value && typeof row.value === 'object' ? row.value : {};
  return {
    quizCorrection: value.quizCorrection === true,
    assistant: value.assistant === true,
    modelImport: value.modelImport === true,
  };
}

export async function getAdminContext(userId, profile = {}) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const actorName = [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    || (profile.username ? '@' + profile.username : String(id));
  if (id === OWNER_ID) {
    return {
      telegramId: id, actorName, isOwner: true, permissions: ['*'],
      scopeCourseIds: ['*'], roleKey: 'owner',
      featureFlags: await getModeratorFeatures(id),
    };
  }
  const row = await db.select().from(moderators).where(eq(moderators.telegramId, id)).get();
  if (!row || !row.isActive) return null;
  return {
    telegramId: id,
    actorName: row.displayName || actorName,
    isOwner: false,
    moderator: row,
    roleKey: row.roleKey,
    permissions: [...new Set((Array.isArray(row.permissions) ? row.permissions : []).filter(v => typeof v === 'string'))],
    scopeCourseIds: Array.isArray(row.scopeCourseIds) ? row.scopeCourseIds : [],
    featureFlags: await getModeratorFeatures(id),
  };
}

export async function hasModeratorFeature(userId, featureKey) {
  if (!MODERATOR_FEATURES.includes(featureKey)) return false;
  const context = await getAdminContext(userId);
  return Boolean(context && (context.isOwner || context.featureFlags?.[featureKey] === true));
}

export async function isAdminUser(userId) {
  return Boolean(await getAdminContext(userId));
}
