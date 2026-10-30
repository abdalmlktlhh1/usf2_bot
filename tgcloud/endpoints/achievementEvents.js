import { db, EndpointError } from 'sdk';
import { asc, desc, eq, gt } from 'sdk/db';
import { achievementEvents } from '../schema.js';

const ACHIEVEMENTS = {
  rank_bronze:   ['🛡️', 'درع إحسان البرونزي', 'بدأ مسيرته في إحسان وأحرز أول إنجاز محفوظ.'],
  rank_copper:   ['🛡️', 'درع إحسان النحاسي', 'أكمل خمسة اختبارات وانتقل إلى المرتبة النحاسية.'],
  rank_iron:     ['🛡️', 'درع إحسان الحديدي', 'أكمل عشرة اختبارات وبلغ المرتبة الحديدية.'],
  rank_silver:   ['🛡️', 'درع إحسان الفضي', 'أكمل ٢٥ اختبارًا وارتقى إلى المرتبة الفضية.'],
  rank_gold:     ['🛡️', 'درع إحسان الذهبي', 'أكمل ٥٠ اختبارًا وبلغ المرتبة الذهبية.'],
  rank_platinum: ['🛡️', 'درع إحسان البلاتيني', 'أكمل ١٠٠ اختبار وبلغ مرتبة النخبة البلاتينية.'],
  rank_diamond:  ['💠', 'درع إحسان الماسي', 'أكمل ٢٥٠ اختبارًا وبلغ أعلى مراتب دروع إحسان.'],
  badge_first_light: ['🌟', 'وسام خطوة النور', 'أنهى أول اختبار له. هذه بداية طريق العلم!'],
  badge_knowledge_companion: ['📖', 'وسام رفيق المعرفة', 'أكمل خمسة اختبارات؛ استمر في التقدم.'],
  badge_mastery_gem: ['💎', 'وسام جوهرة الإتقان', 'حقق ٩٠٪ أو أكثر في أحد اختباراته.'],
  badge_science_traveler: ['🧭', 'وسام رحّالة العلم', 'أكمل خمسة نماذج مختلفة.'],
  milestone_level_two: ['🔥', 'ارتقى إلى المستوى الثاني', 'أكمل عشرة اختبارات محفوظة.'],
  milestone_level_three: ['🚀', 'ارتقى إلى المستوى الثالث', 'أكمل ٢٥ اختبارًا محفوظًا.'],
  milestone_level_four: ['👑', 'بلغ المستوى الرابع', 'أكمل ٥٠ اختبارًا محفوظًا؛ إنجاز يستحق التقدير.'],
  badge_perfect_score: ['✨', 'وسام العلامة الكاملة', 'أجاب عن جميع الأسئلة المحتسبة إجابة صحيحة.'],
};

const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export default async function(input = {}, ctx) {
  const user = ctx?.initData?.user;
  const telegramId = Number(user?.id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    throw new EndpointError('افتح المنصة من داخل Telegram لتلقي إعلانات الإنجازات.', { code: 'TELEGRAM_REQUIRED' });
  }

  const action = input.action;
  if (action === 'latest') {
    const latest = await db.select({ id: achievementEvents.id }).from(achievementEvents)
      .orderBy(desc(achievementEvents.id)).get();
    return { cursor: Number(latest?.id || 0) };
  }

  if (action === 'feed') {
    const afterId = Number(input.afterId ?? 0);
    if (!Number.isSafeInteger(afterId) || afterId < 0) {
      throw new EndpointError('مؤشر إشعارات الإنجاز غير صالح.', { code: 'INVALID_CURSOR' });
    }
    const rows = await db.select().from(achievementEvents)
      .where(gt(achievementEvents.id, afterId))
      .orderBy(asc(achievementEvents.id)).limit(30).all();
    return {
      events: (rows || []).map(row => ({
        id: Number(row.id), telegramId: Number(row.telegramId), achievementKey: row.achievementKey,
        icon: row.icon, title: row.title, message: row.message,
        displayName: row.displayName, username: row.username, createdAt: Number(row.createdAt),
      })),
      cursor: rows?.length ? Number(rows[rows.length - 1].id) : afterId,
    };
  }

  if (action === 'publish') {
    const keys = Array.isArray(input.achievementKeys)
      ? [...new Set(input.achievementKeys.filter(key => typeof key === 'string' && Object.hasOwn(ACHIEVEMENTS, key)))].slice(0, 10)
      : [];
    if (!keys.length) return { published: 0 };
    const fullName = [clean(user?.first_name, 60), clean(user?.last_name, 60)].filter(Boolean).join(' ');
    const displayName = fullName || (clean(user?.username, 64) ? '@' + clean(user?.username, 64) : 'أحد طلاب إحسان');
    let published = 0;
    for (const key of keys) {
      const [icon, title, message] = ACHIEVEMENTS[key];
      const result = await db.insert(achievementEvents).values({
        telegramId, achievementKey: key, icon, title, message, displayName,
        username: clean(user?.username, 64), createdAt: Date.now(),
      }).onConflictDoNothing().run();
      if (Number(result?.changes || result?.rowsAffected || 0) > 0) published += 1;
    }
    return { published };
  }

  throw new EndpointError('عملية إشعارات الإنجاز غير معروفة.', { code: 'UNKNOWN_ACTION' });
}
