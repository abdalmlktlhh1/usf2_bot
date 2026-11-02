import { db } from 'sdk';
import { eq } from 'sdk/db';
import { siteSettings } from '../schema.js';

const keyFor = (userId) => 'model_upload:' + Number(userId);

export async function getModelUploadState(userId) {
  const row = await db.select().from(siteSettings).where(eq(siteSettings.key, keyFor(userId))).get();
  return row?.value && typeof row.value === 'object' ? row.value : null;
}

export async function saveModelUploadState(userId, value) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('حساب Telegram غير صالح.');
  await db.insert(siteSettings).values({
    key: keyFor(id), value, updatedAt: Date.now(), updatedBy: id,
  }).onConflictDoUpdate({
    target: siteSettings.key,
    set: { value, updatedAt: Date.now(), updatedBy: id },
  }).run();
  return value;
}

export async function clearModelUploadState(userId) {
  await db.delete(siteSettings).where(eq(siteSettings.key, keyFor(userId))).run();
}

export const MODEL_UPLOAD_SYSTEMS = {
  general: 'العام',
  parallel: 'الموازي',
  fee: 'النفقة',
};

export const MODEL_UPLOAD_AUDIENCES = {
  students: 'طلاب',
  female: 'طالبات',
};

export const MODEL_UPLOAD_PERIODS = {
  1: 'الفترة الأولى',
  2: 'الفترة الثانية',
  3: 'الفترة الثالثة',
  4: 'الفترة الرابعة',
  5: 'الفترة الخامسة',
};
