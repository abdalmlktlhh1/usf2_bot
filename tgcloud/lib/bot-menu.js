import { db } from 'sdk';
import { asc, eq } from 'sdk/db';
import { botMenuItems } from '../schema.js';

const MINI_APP_URL = 'https://app8964547541.tgcloud.ai/';
const VALID_TYPES = new Set(['submenu', 'web_app', 'url', 'command', 'message', 'catalog']);
const VALID_COMMANDS = new Set(['quiz', 'help', 'about', 'home']);

function safeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export async function allBotMenuItems() {
  return db.select().from(botMenuItems).orderBy(asc(botMenuItems.sortOrder), asc(botMenuItems.id)).all();
}

export async function ensureDefaultBotMenu() {
  const existing = await allBotMenuItems();
  if (existing.length) return existing;
  const now = Date.now();
  const defaults = [
    { text: '📱 الاختبار التفاعلي', type: 'web_app', value: 'exam', sortOrder: 10, adminOnly: false },
    { text: '⚙️ لوحة الإدارة', type: 'web_app', value: 'admin', sortOrder: 20, adminOnly: true },
    { text: '📝 ابدأ اختبارًا نصيًا', type: 'command', value: 'quiz', sortOrder: 30, adminOnly: false },
    { text: '❔ طريقة الاستخدام', type: 'command', value: 'help', sortOrder: 40, adminOnly: false },
  ];
  for (const item of defaults) {
    await db.insert(botMenuItems).values({
      ...item, parentId: null, description: '', isActive: true,
      createdBy: 5187563344, createdAt: now, updatedAt: now,
    }).run();
  }
  return allBotMenuItems();
}

export function validateBotMenuItem(input, rows, currentId = 0) {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > 64) throw new Error('اسم الزر مطلوب وبحد أقصى 64 حرفًا.');
  const type = String(input.type || '');
  if (!VALID_TYPES.has(type)) throw new Error('نوع الزر غير مدعوم.');
  const value = typeof input.value === 'string' ? input.value.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (description.length > 3500) throw new Error('وصف الزر أطول من المسموح.');
  if (type === 'url' && !safeUrl(value)) throw new Error('رابط الزر يجب أن يبدأ بـ https://.');
  if (type === 'web_app' && !['exam', 'admin'].includes(value)) throw new Error('اختر منصة الاختبارات أو لوحة الإدارة.');
  if (type === 'command' && !VALID_COMMANDS.has(value)) throw new Error('اختر وظيفة من الوظائف المحددة في القائمة.');
  if (type === 'message' && !description) throw new Error('اكتب نص الرسالة التي سيعرضها الزر.');
  if (type === 'catalog') {
    let target;
    try { target = JSON.parse(value); } catch { throw new Error('اختر مستوى أو مادة أو مقررًا أو نموذجًا.'); }
    if (!target || !['level','subject','course','model'].includes(target.targetType)) throw new Error('نوع وجهة المحتوى غير صالح.');
    if (!Number.isSafeInteger(Number(target.targetId)) || Number(target.targetId) <= 0) throw new Error('اختر وجهة محتوى صحيحة.');
    if (target.targetType === 'model' && (!Number(target.courseId) || !Number(target.sourceYear) || !String(target.sourceFile || '').trim())) throw new Error('بيانات النموذج غير مكتملة.');
  }
  if (type === 'submenu' && value) throw new Error('الزر الفرعي لا يحتاج إلى رابط أو وظيفة.');
  if (type !== 'submenu' && type !== 'web_app' && type !== 'url' && type !== 'command' && type !== 'message' && type !== 'catalog') {
    throw new Error('نوع الزر غير صالح.');
  }
  const order = Number(input.sortOrder);
  if (!Number.isSafeInteger(order) || order < 0 || order > 1000000) throw new Error('ترتيب الزر غير صالح.');
  const parentId = input.parentId == null || input.parentId === '' ? null : Number(input.parentId);
  if (parentId !== null) {
    if (!Number.isSafeInteger(parentId) || parentId <= 0) throw new Error('القائمة الأم غير صالحة.');
    const parent = rows.find((row) => Number(row.id) === parentId);
    if (!parent || parent.type !== 'submenu' || !parent.isActive) throw new Error('اختر زرًا فرعيًا نشطًا ليكون القائمة الأم.');
    if (parentId === currentId) throw new Error('لا يمكن جعل الزر داخل نفسه.');
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    let cursor = parent;
    let depth = 1;
    while (cursor?.parentId != null) {
      if (Number(cursor.parentId) === currentId) throw new Error('لا يمكن نقل الزر داخل إحدى قوائمه الفرعية.');
      cursor = byId.get(Number(cursor.parentId));
      if (++depth > 12) throw new Error('تجاوز عمق القوائم الحد المسموح.');
    }
    if (depth >= 5) throw new Error('أقصى عمق للقوائم الفرعية خمسة مستويات.');
  }
  if (type === 'submenu' && description.length > 300) throw new Error('وصف القائمة الفرعية يجب ألا يتجاوز 300 حرف.');
  return {
    parentId, text, type, value: type === 'submenu' ? '' : value,
    description, sortOrder: order, isActive: input.isActive !== false,
    adminOnly: input.adminOnly === true,
  };
}

export async function getBotMenuKeyboard(isAdmin, parentId = null) {
  const all = await ensureDefaultBotMenu();
  const visible = all.filter((item) => item.isActive && (!item.adminOnly || isAdmin));
  const byId = new Map(all.map((item) => [Number(item.id), item]));
  const parent = parentId == null ? null : visible.find((item) => Number(item.id) === Number(parentId));
  if (parentId != null && (!parent || parent.type !== 'submenu')) {
    return getBotMenuKeyboard(isAdmin, null);
  }
  // A nested menu is reachable only when every ancestor is active and visible to this user.
  let ancestor = parent;
  let depth = 0;
  while (ancestor) {
    if (!ancestor.isActive || (ancestor.adminOnly && !isAdmin) || ++depth > 5) {
      return getBotMenuKeyboard(isAdmin, null);
    }
    ancestor = ancestor.parentId == null ? null : byId.get(Number(ancestor.parentId));
    if (ancestor === undefined) return getBotMenuKeyboard(isAdmin, null);
  }
  const entries = visible.filter((item) => (item.parentId == null ? null : Number(item.parentId)) === (parentId == null ? null : Number(parentId)));
  const rows = [];
  for (const item of entries) {
    let button;
    if (item.type === 'submenu') {
      button = { text: item.text, callback_data: 'menu:open:' + item.id };
    } else if (item.type === 'web_app') {
      if (item.value === 'admin' && !isAdmin) continue;
      button = { text: item.text, web_app: { url: item.value === 'admin' ? MINI_APP_URL + 'admin.html?v=20261025a' : MINI_APP_URL } };
    } else if (item.type === 'catalog') {
      let target;
      try { target = JSON.parse(item.value); } catch { continue; }
      const params = new URLSearchParams();
      params.set('target', target.targetType);
      params.set('id', String(target.targetId));
      if (target.targetType === 'model') {
        params.set('courseId', String(target.courseId));
        params.set('year', String(target.sourceYear));
        params.set('file', String(target.sourceFile));
      }
      button = { text: item.text, web_app: { url: MINI_APP_URL + '?' + params.toString() } };
    } else if (item.type === 'url') {
      if (!safeUrl(item.value)) continue;
      button = { text: item.text, url: item.value };
    } else if (item.type === 'command') {
      button = { text: item.text, callback_data: 'menu:action:' + item.value };
    } else if (item.type === 'message') {
      button = { text: item.text, callback_data: 'menu:message:' + item.id };
    }
    if (button) rows.push([button]);
  }
  if (parentId != null) {
    rows.push([{ text: '↩️ رجوع', callback_data: parent?.parentId == null ? 'menu:home' : 'menu:open:' + parent.parentId }]);
    rows.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'menu:home' }]);
  }
  if (!rows.length) rows.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'menu:home' }]);
  return { inline_keyboard: rows };
}

export async function getBotMenuItem(id) {
  return db.select().from(botMenuItems).where(eq(botMenuItems.id, Number(id))).get();
}

export function isValidMenuCommand(value) {
  return VALID_COMMANDS.has(value);
}

export async function isBotMenuItemVisible(id, isAdmin) {
  const rows = await ensureDefaultBotMenu();
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  let current = byId.get(Number(id));
  let depth = 0;
  if (!current) return false;
  while (current) {
    if (!current.isActive || (current.adminOnly && !isAdmin) || ++depth > 5) return false;
    current = current.parentId == null ? null : byId.get(Number(current.parentId));
    if (current === undefined) return false;
  }
  return true;
}
