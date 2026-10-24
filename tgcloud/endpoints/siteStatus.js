import { db } from 'sdk';
import { eq } from 'sdk/db';
import { siteSettings } from '../schema.js';

// Public read-only endpoint. Only the owner-authenticated adminApi can change this value.
export default async function () {
  const row = await db.select().from(siteSettings).where(eq(siteSettings.key, 'maintenance')).get();
  const value = row?.value && typeof row.value === 'object' ? row.value : {};
  return {
    enabled: value.enabled === true,
    message: typeof value.message === 'string' && value.message.trim()
      ? value.message
      : 'الموقع تحت الصيانة حاليًا. نعمل على تحسين الخدمة، يرجى العودة لاحقًا.',
    updatedAt: value.updatedAt || null,
  };
}
