import { db, EndpointError } from 'sdk';
import { desc, eq } from 'sdk/db';
import {
  moderators,
  auditLogs,
  botMenuItems,
  siteSettings,
  visitorStats,
} from '../schema.js';
import { supabaseContentRequest } from '../lib/supabase-content.js';
import { allBotMenuItems, ensureDefaultBotMenu, validateBotMenuItem } from '../lib/bot-menu.js';

const OWNER_ID = 5187563344;
const PERMISSIONS = [
  'levels.read', 'levels.write',
  'subjects.read', 'subjects.write',
  'courses.read', 'courses.write',
  'questions.read', 'questions.write', 'questions.publish', 'questions.delete',
  'statistics.read', 'audit.read', 'students.read',
];
const ROLE_PRESETS = {
  academic_manager: [
    'levels.read', 'levels.write', 'subjects.read', 'subjects.write',
    'courses.read', 'courses.write', 'questions.read', 'questions.write',
    'questions.publish', 'statistics.read', 'students.read',
  ],
  question_editor: ['courses.read', 'questions.read', 'questions.write'],
  reviewer: ['courses.read', 'questions.read', 'questions.publish'],
  content_viewer: [
    'levels.read', 'subjects.read', 'courses.read', 'questions.read',
  ],
  statistics_viewer: ['statistics.read'],
  auditor: ['audit.read', 'statistics.read'],
  custom: [],
};
const PERMISSION_LABELS = {
  'levels.read': 'عرض المستويات',
  'levels.write': 'إضافة وتعديل المستويات',
  'subjects.read': 'عرض المواد',
  'subjects.write': 'إضافة وتعديل المواد',
  'courses.read': 'عرض المقررات',
  'courses.write': 'إضافة وتعديل المقررات',
  'questions.read': 'عرض الأسئلة والإجابات',
  'questions.write': 'إضافة وتعديل الأسئلة',
  'questions.publish': 'نشر الأسئلة أو إلغاء نشرها',
  'questions.delete': 'أرشفة الأسئلة',
  'statistics.read': 'عرض إحصائيات المحتوى',
  'audit.read': 'عرض سجل العمليات',
  'students.read': 'عرض حسابات الطلاب وحالاتها',
};

function fail(message, code = 'BAD_REQUEST') {
  throw new EndpointError(message, { code });
}
function positiveId(value, label = 'المعرّف') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) fail(label + ' غير صالح.');
  return n;
}
function cleanString(value, label, maxLength, required = true) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) fail('حقل ' + label + ' مطلوب.');
  if (result.length > maxLength) fail('حقل ' + label + ' طويل أكثر من المسموح.');
  return result;
}
function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((v) => typeof v === 'string'))];
}
function allowed(auth, permission) {
  return auth.isOwner || auth.permissions.includes('*') || auth.permissions.includes(permission);
}
function requirePermission(auth, permission) {
  if (!allowed(auth, permission)) fail('لا تملك الصلاحية اللازمة لهذه العملية.', 'FORBIDDEN');
}
function requireGlobalCatalogScope(auth) {
  if (!auth.isOwner && !auth.scopeCourseIds.includes('*')) {
    fail('هذه العملية تتطلب نطاق إدارة جميع المقررات.', 'SCOPE_FORBIDDEN');
  }
}
function canAccessCourse(auth, courseId) {
  return auth.isOwner || auth.scopeCourseIds.includes('*') || auth.scopeCourseIds.includes(Number(courseId));
}
function requireCourseScope(auth, courseId) {
  if (!canAccessCourse(auth, courseId)) fail('هذا المقرر خارج نطاق صلاحياتك.', 'SCOPE_FORBIDDEN');
}
async function authorize(ctx) {
  const user = ctx?.initData?.user;
  const telegramId = Number(user?.id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    fail('تعذّر التحقق من حساب Telegram. افتح التطبيق من داخله.', 'UNAUTHENTICATED');
  }
  const actorName = [user.first_name, user.last_name].filter(Boolean).join(' ')
    || (user.username ? '@' + user.username : String(telegramId));
  if (telegramId === OWNER_ID) {
    return {
      telegramId, actorName, isOwner: true, permissions: ['*'],
      scopeCourseIds: ['*'], roleKey: 'owner',
    };
  }
  const row = await db.select().from(moderators)
    .where(eq(moderators.telegramId, telegramId)).get();
  if (!row || !row.isActive) {
    fail('هذا الحساب غير مخوّل باستخدام لوحة الإدارة.', 'FORBIDDEN');
  }
  return {
    telegramId,
    actorName,
    isOwner: false,
    moderator: row,
    roleKey: row.roleKey,
    permissions: uniqueStrings(row.permissions),
    scopeCourseIds: Array.isArray(row.scopeCourseIds) ? row.scopeCourseIds : [],
  };
}
async function audit(auth, action, entityType, entityId = 0, details = {}) {
  await db.insert(auditLogs).values({
    actorId: auth.telegramId,
    actorName: auth.actorName,
    action,
    entityType,
    entityId: Number.isSafeInteger(Number(entityId)) ? Number(entityId) : 0,
    details,
    createdAt: Date.now(),
  }).run();
}

async function rowsForDashboard(auth) {
  const content = await supabaseContentRequest('dashboard', { summaryOnly: true }, auth);
  const allLevels = content.levels || [];
  const allSubjects = content.subjects || [];
  const allCourses = content.courses || [];
  const allQuestions = content.questions || [];
  const compactQuestionCounts = Number.isFinite(Number(content.questionCount)) && Number.isFinite(Number(content.activeQuestionCount));

  const canSeeLevels = allowed(auth, 'levels.read') || allowed(auth, 'levels.write');
  const canSeeSubjects = allowed(auth, 'subjects.read') || allowed(auth, 'subjects.write');
  const canSeeCourses = allowed(auth, 'courses.read') || allowed(auth, 'courses.write');
  const canSeeQuestions = allowed(auth, 'questions.read') || allowed(auth, 'questions.write') ||
    allowed(auth, 'questions.publish') || allowed(auth, 'questions.delete');

  const visibleCourses = canSeeCourses || canSeeQuestions
    ? allCourses.filter((row) => canAccessCourse(auth, row.id))
    : [];
  const visibleSubjects = allSubjects.filter((row) => {
    if (canSeeSubjects && (auth.isOwner || auth.scopeCourseIds.includes('*'))) return true;
    return visibleCourses.some((course) => course.subjectId === row.id);
  });
  const visibleLevelIds = new Set(visibleSubjects.map((row) => row.levelId));
  const visibleLevels = allLevels.filter((row) => {
    if (canSeeLevels && (auth.isOwner || auth.scopeCourseIds.includes('*'))) return true;
    return visibleLevelIds.has(row.id);
  });
  const visibleQuestions = canSeeQuestions
    ? allQuestions.filter((row) => canAccessCourse(auth, row.courseId))
    : [];
  const modelMap = new Map();
  for (const q of visibleQuestions) {
    const sourceYear = Number(q.sourceYear) || 0;
    const sourceFile = String(q.sourceFile || 'بلا اسم');
    const id = encodeURIComponent(JSON.stringify([Number(q.courseId), sourceYear, sourceFile]));
    if (!modelMap.has(id)) modelMap.set(id, { id, courseId: Number(q.courseId), sourceYear, sourceFile, total: 0, activeCount: 0, isActive: false });
    const model = modelMap.get(id);
    model.total++;
    if (q.isActive) model.activeCount++;
    model.isActive = model.activeCount > 0;
  }
  const visibleModels = [...modelMap.values()].sort((a, b) =>
    a.courseId - b.courseId || b.sourceYear - a.sourceYear || a.sourceFile.localeCompare(b.sourceFile, 'ar'));

  let visibleModerators = [];
  if (auth.isOwner) {
    visibleModerators = await db.select().from(moderators).orderBy(desc(moderators.createdAt)).all();
  }

  let logs = [];
  if (auth.isOwner || allowed(auth, 'audit.read')) {
    const allLogs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100).all();
    logs = auth.isOwner ? allLogs : allLogs.filter((row) => row.actorId === auth.telegramId);
  }

  const stats = {};
  if (auth.isOwner || allowed(auth, 'statistics.read')) {
    const statCourses = allCourses.filter((row) => canAccessCourse(auth, row.id));
    const statCourseIds = new Set(statCourses.map((row) => row.id));
    const statSubjects = allSubjects.filter((row) => statCourses.some((course) => course.subjectId === row.id));
    const statLevelIds = new Set(statSubjects.map((row) => row.levelId));
    const statQuestions = allQuestions.filter((row) => statCourseIds.has(row.courseId));
    stats.levels = allLevels.filter((row) => statLevelIds.has(row.id)).length;
    stats.subjects = statSubjects.length;
    stats.courses = statCourses.length;
    stats.questions = compactQuestionCounts && (auth.isOwner || auth.scopeCourseIds.includes('*'))
      ? Number(content.questionCount) : statQuestions.length;
    stats.activeQuestions = compactQuestionCounts && (auth.isOwner || auth.scopeCourseIds.includes('*'))
      ? Number(content.activeQuestionCount) : statQuestions.filter((row) => row.isActive).length;
    stats.moderators = auth.isOwner ? visibleModerators.filter((row) => row.isActive).length : null;
    if (auth.isOwner) {
      // Do not scan the entire visitor table while the admin dashboard is opening.
      // Visitor analytics must be served by a dedicated aggregate query.
      stats.totalVisitors = null;
      stats.currentUsers = null;
    }
  }

  return {
    user: { telegramId: auth.telegramId, displayName: auth.actorName, isOwner: auth.isOwner, roleKey: auth.roleKey },
    permissions: auth.permissions,
    permissionLabels: PERMISSION_LABELS,
    rolePresets: Object.entries(ROLE_PRESETS).map(([key, value]) => ({ key, permissions: value })),
    levels: canSeeLevels || canSeeSubjects || canSeeCourses || canSeeQuestions ? visibleLevels : [],
    subjects: canSeeSubjects || canSeeCourses || canSeeQuestions ? visibleSubjects : [],
    courses: visibleCourses,
    // Keep the initial dashboard response compact; question records are loaded page-by-page.
    questions: [],
    questionCount: compactQuestionCounts && (auth.isOwner || auth.scopeCourseIds.includes('*'))
      ? Number(content.questionCount) : visibleQuestions.length,
    models: visibleModels,
    moderators: visibleModerators,
    logs,
    stats,
    canManageModerators: auth.isOwner,
    canManageCatalog: auth.isOwner || auth.scopeCourseIds.includes('*'),
  };
}

async function rowsForQuestionsPage(auth, input = {}) {
  const canSeeQuestions = ['questions.read', 'questions.write', 'questions.publish', 'questions.delete']
    .some((permission) => allowed(auth, permission));
  if (!canSeeQuestions) fail('لا تملك صلاحية عرض الأسئلة.', 'FORBIDDEN');
  const content = await supabaseContentRequest('dashboard', {}, auth);
  const courses = content.courses || [];
  const courseNames = new Map(courses.map((course) => [Number(course.id), String(course.name || '')]));
  const query = cleanString(input.query || '', 'عبارة البحث', 250, false).toLocaleLowerCase('ar');
  const modelFilter = input.model && typeof input.model === 'object' ? input.model : null;
  const questions = (content.questions || []).filter((row) => {
    if (!canAccessCourse(auth, row.courseId)) return false;
    if (input.reviewOnly === true && (!row.reviewStatus || row.reviewStatus === 'approved')) return false;
    if (input.reviewOnly === true && row.reviewStatus === 'approved') return false;
    if (modelFilter) {
      if (Number(row.courseId) !== Number(modelFilter.courseId)) return false;
      if (Number(row.sourceYear || 0) !== Number(modelFilter.sourceYear || 0)) return false;
      if (String(row.sourceFile || 'بلا اسم') !== String(modelFilter.sourceFile || 'بلا اسم')) return false;
    }
    if (!query) return true;
    const haystack = [row.questionText, courseNames.get(Number(row.courseId)), row.sourceFile, row.sourceYear]
      .join(' ').toLocaleLowerCase('ar');
    return haystack.includes(query);
  });
  const pageSize = Math.max(1, Math.min(25, Number.isSafeInteger(Number(input.pageSize)) ? Number(input.pageSize) : 25));
  const pageCount = Math.max(1, Math.ceil(questions.length / pageSize));
  const page = Math.max(1, Math.min(pageCount, Number.isSafeInteger(Number(input.page)) ? Number(input.page) : 1));
  const start = (page - 1) * pageSize;
  const items = questions.slice(start, start + pageSize).map((q) => ({
    id: q.id, courseId: q.courseId, questionText: q.questionText, options: q.options,
    correctIndex: q.correctIndex, explanation: q.explanation, difficulty: q.difficulty,
    sourceYear: q.sourceYear, sourceFile: q.sourceFile, sortOrder: q.sortOrder, isActive: q.isActive,
    reviewStatus: q.reviewStatus, reviewFlags: q.reviewFlags || [],
  }));
  return { questions: items, total: questions.length, page, pageSize, pageCount };
}

async function saveLevel(auth, input) {
  requirePermission(auth, 'levels.write');
  requireGlobalCatalogScope(auth);
  const result = await supabaseContentRequest('saveLevel', input, auth);
  await audit(auth, input.id ? 'update' : 'create', 'level', result.saved.id, { name: result.saved.name });
  return result;
}

async function setLevelActive(auth, input) {
  requirePermission(auth, 'levels.write');
  requireGlobalCatalogScope(auth);
  const result = await supabaseContentRequest('setLevelActive', input, auth);
  await audit(auth, result.isActive ? 'activate' : 'archive', 'level', result.id, { isActive: result.isActive });
  return result;
}

async function saveSubject(auth, input) {
  requirePermission(auth, 'subjects.write');
  requireGlobalCatalogScope(auth);
  const result = await supabaseContentRequest('saveSubject', input, auth);
  await audit(auth, input.id ? 'update' : 'create', 'subject', result.saved.id, { name: result.saved.name, levelId: result.saved.levelId });
  return result;
}

async function setSubjectActive(auth, input) {
  requirePermission(auth, 'subjects.write');
  requireGlobalCatalogScope(auth);
  const result = await supabaseContentRequest('setSubjectActive', input, auth);
  await audit(auth, result.isActive ? 'activate' : 'archive', 'subject', result.id, { isActive: result.isActive });
  return result;
}

async function saveCourse(auth, input) {
  requirePermission(auth, 'courses.write');
  requireGlobalCatalogScope(auth);
  const result = await supabaseContentRequest('saveCourse', input, auth);
  await audit(auth, input.id ? 'update' : 'create', 'course', result.saved.id, { name: result.saved.name, subjectId: result.saved.subjectId });
  return result;
}

async function setCourseActive(auth, input) {
  requirePermission(auth, 'courses.write');
  requireGlobalCatalogScope(auth);
  const result = await supabaseContentRequest('setCourseActive', input, auth);
  await audit(auth, result.isActive ? 'activate' : 'archive', 'course', result.id, { isActive: result.isActive });
  return result;
}

async function saveQuestion(auth, input) {
  requirePermission(auth, 'questions.write');
  requireCourseScope(auth, positiveId(input.courseId, 'المقرر'));
  const result = await supabaseContentRequest('saveQuestion', input, auth);
  await audit(auth, input.id ? 'update' : 'create', 'question', result.saved.id, {
    courseId: result.saved.courseId, questionPreview: String(result.saved.questionText || '').slice(0, 100),
  });
  return result;
}

async function setQuestionActive(auth, input) {
  const id = positiveId(input.id, 'السؤال');
  const content = await supabaseContentRequest('dashboard', {}, auth);
  const current = (content.questions || []).find((row) => Number(row.id) === id);
  if (!current) fail('السؤال غير موجود.', 'NOT_FOUND');
  requireCourseScope(auth, current.courseId);
  const isActive = input.isActive === true;
  if (!isActive) requirePermission(auth, 'questions.delete');
  else requirePermission(auth, 'questions.publish');
  const result = await supabaseContentRequest('setQuestionActive', { id, isActive }, auth);
  await audit(auth, isActive ? 'publish' : 'archive', 'question', id, {
    courseId: current.courseId, questionPreview: String(current.questionText || '').slice(0, 100),
  });
  return result;
}
async function renameModel(auth, input) {
  requirePermission(auth, 'questions.write');
  const courseId = positiveId(input.courseId, 'المقرر');
  requireCourseScope(auth, courseId);
  const result = await supabaseContentRequest('renameModel', input, auth);
  await audit(auth, 'rename', 'model', 0, {
    courseId, oldYear: input.sourceYear, oldFile: input.sourceFile,
    newYear: result.sourceYear, newFile: result.sourceFile, updated: result.updated,
  });
  return result;
}
async function setModelActive(auth, input) {
  const courseId = positiveId(input.courseId, 'المقرر');
  requireCourseScope(auth, courseId);
  const isActive = input.isActive === true;
  requirePermission(auth, isActive ? 'questions.publish' : 'questions.delete');
  const result = await supabaseContentRequest('setModelActive', input, auth);
  await audit(auth, isActive ? 'publish' : 'archive', 'model', 0, {
    courseId, sourceYear: input.sourceYear, sourceFile: input.sourceFile, updated: result.updated,
  });
  return result;
}
async function saveModerator(auth, input) {
  if (!auth.isOwner) fail('إدارة المشرفين مخصصة للمدير الرئيسي فقط.', 'FORBIDDEN');
  const telegramId = positiveId(input.telegramId, 'معرّف Telegram');
  if (telegramId === OWNER_ID) fail('لا يمكن تغيير صلاحيات المدير الرئيسي أو استبداله.');
  const displayName = cleanString(input.displayName || 'مشرف', 'اسم المشرف', 120);
  const roleKey = Object.hasOwn(ROLE_PRESETS, input.roleKey) ? input.roleKey : 'custom';
  const requestedPermissions = Array.isArray(input.permissions)
    ? input.permissions.filter((p) => PERMISSIONS.includes(p))
    : ROLE_PRESETS[roleKey];
  const permissions = [...new Set(requestedPermissions)];
  let scopeCourseIds;
  if (Array.isArray(input.scopeCourseIds) && input.scopeCourseIds.includes('*')) {
    scopeCourseIds = ['*'];
  } else {
    scopeCourseIds = [...new Set((Array.isArray(input.scopeCourseIds) ? input.scopeCourseIds : [])
      .map(Number).filter((n) => Number.isSafeInteger(n) && n > 0))];
    const content = await supabaseContentRequest('dashboard', {}, auth);
    for (const id of scopeCourseIds) {
      if (!(content.courses || []).some((item) => Number(item.id) === Number(id))) {
        fail('أحد المقررات المحددة للصلاحيات غير موجود.');
      }
    }
  }
  const current = await db.select().from(moderators).where(eq(moderators.telegramId, telegramId)).get();
  const now = Date.now();
  const data = {
    telegramId,
    displayName,
    roleKey,
    permissions,
    scopeCourseIds,
    isActive: input.isActive !== false,
    createdBy: current?.createdBy ?? auth.telegramId,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  await db.insert(moderators).values(data).onConflictDoUpdate({
    target: moderators.telegramId,
    set: {
      displayName, roleKey, permissions, scopeCourseIds, isActive: data.isActive, updatedAt: now,
    },
  }).run();
  await audit(auth, current ? 'update' : 'create', 'moderator', telegramId, {
    displayName, roleKey, permissions, scopeCourseIds, isActive: data.isActive,
  });
  return { telegramId, displayName, roleKey, permissions, scopeCourseIds, isActive: data.isActive };
}
async function setModeratorActive(auth, input) {
  if (!auth.isOwner) fail('إدارة المشرفين مخصصة للمدير الرئيسي فقط.', 'FORBIDDEN');
  const telegramId = positiveId(input.telegramId, 'معرّف Telegram');
  if (telegramId === OWNER_ID) fail('لا يمكن تعطيل حساب المدير الرئيسي.');
  const current = await db.select().from(moderators).where(eq(moderators.telegramId, telegramId)).get();
  if (!current) fail('المشرف غير موجود.', 'NOT_FOUND');
  const isActive = input.isActive === true;
  await db.update(moderators).set({ isActive, updatedAt: Date.now() })
    .where(eq(moderators.telegramId, telegramId)).run();
  await audit(auth, isActive ? 'activate' : 'revoke', 'moderator', telegramId, { displayName: current.displayName });
  return { telegramId, isActive };
}

function requireMenuOwner(auth) {
  if (!auth.isOwner) fail('إدارة أزرار البوت مخصصة للمدير الرئيسي فقط.', 'FORBIDDEN');
}
async function listBotMenuForAdmin(auth) {
  requireMenuOwner(auth);
  return { items: await ensureDefaultBotMenu() };
}
async function saveBotMenuItem(auth, input) {
  requireMenuOwner(auth);
  const rows = await allBotMenuItems();
  const id = input.id == null || input.id === '' ? null : positiveId(input.id, 'معرّف الزر');
  const current = id == null ? null : rows.find((row) => Number(row.id) === id);
  if (id != null && !current) fail('الزر المطلوب غير موجود.', 'NOT_FOUND');
  if (current && current.type === 'submenu' && input.type !== 'submenu' && rows.some((row) => Number(row.parentId) === Number(id))) {
    fail('لا يمكن تغيير نوع قائمة تحتوي أزرارًا فرعية. انقل الأزرار الفرعية أو احذفها أولًا.');
  }
  let data;
  try { data = validateBotMenuItem(input, rows, id || 0); }
  catch (error) { fail(error?.message || 'بيانات الزر غير صالحة.'); }
  if (data.type === 'web_app' && data.value === 'admin') data.adminOnly = true;
  if (data.parentId != null) {
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    let ancestor = byId.get(Number(data.parentId));
    let depth = 0;
    while (ancestor && depth++ < 5) {
      if (ancestor.adminOnly) data.adminOnly = true;
      ancestor = ancestor.parentId == null ? null : byId.get(Number(ancestor.parentId));
    }
  }
  const siblingCount = rows.filter((row) => Number(row.id) !== Number(id || 0) &&
    (row.parentId == null ? null : Number(row.parentId)) === (data.parentId == null ? null : Number(data.parentId))).length;
  if (siblingCount >= 90) fail('لا يمكن أن تحتوي القائمة الواحدة على أكثر من 90 زرًا.');
  const now = Date.now();
  if (current) {
    await db.update(botMenuItems).set({ ...data, updatedAt: now }).where(eq(botMenuItems.id, id)).run();
    await audit(auth, 'update', 'bot_menu_item', id, { text: data.text, type: data.type, parentId: data.parentId });
    return { id, ...data, updatedAt: now };
  }
  const inserted = await db.insert(botMenuItems).values({
    ...data, createdBy: auth.telegramId, createdAt: now, updatedAt: now,
  }).run();
  const freshRows = await allBotMenuItems();
  const matched = freshRows.filter((row) => Number(row.createdBy) === auth.telegramId && Number(row.createdAt) === now && row.text === data.text &&
    (row.parentId == null ? null : Number(row.parentId)) === (data.parentId == null ? null : Number(data.parentId)))
    .sort((a, b) => Number(b.id) - Number(a.id))[0];
  const insertedId = Number(inserted?.lastInsertRowid ?? inserted?.lastInsertRowId ?? inserted?.insertId ?? matched?.id ?? 0);
  await audit(auth, 'create', 'bot_menu_item', insertedId, { text: data.text, type: data.type, parentId: data.parentId });
  return { id: insertedId || null, ...data, createdAt: now, updatedAt: now };
}
async function deleteBotMenuItem(auth, input) {
  requireMenuOwner(auth);
  const id = positiveId(input.id, 'معرّف الزر');
  const rows = await allBotMenuItems();
  const current = rows.find((row) => Number(row.id) === id);
  if (!current) fail('الزر المطلوب غير موجود.', 'NOT_FOUND');
  if (rows.some((row) => Number(row.parentId) === id)) fail('لا يمكن حذف زر يحتوي أزرارًا فرعية. انقل الأزرار الفرعية أو احذفها أولًا.');
  if (current.parentId == null && rows.filter((row) => row.parentId == null).length <= 1) fail('لا يمكن حذف آخر زر رئيسي؛ يمكنك إخفاؤه بدلًا من ذلك.');
  await db.delete(botMenuItems).where(eq(botMenuItems.id, id)).run();
  await audit(auth, 'delete', 'bot_menu_item', id, { text: current.text, parentId: current.parentId });
  return { id, deleted: true };
}
async function toggleBotMenuItem(auth, input) {
  requireMenuOwner(auth);
  const id = positiveId(input.id, 'معرّف الزر');
  const rows = await allBotMenuItems();
  const current = rows.find((row) => Number(row.id) === id);
  if (!current) fail('الزر المطلوب غير موجود.', 'NOT_FOUND');
  const isActive = input.isActive === true;
  const now = Date.now();
  await db.update(botMenuItems).set({ isActive, updatedAt: now }).where(eq(botMenuItems.id, id)).run();
  await audit(auth, isActive ? 'activate' : 'hide', 'bot_menu_item', id, { text: current.text });
  return { id, isActive };
}
async function moveBotMenuItem(auth, input) {
  requireMenuOwner(auth);
  const id = positiveId(input.id, 'معرّف الزر');
  const direction = input.direction === 'up' ? -1 : input.direction === 'down' ? 1 : 0;
  if (!direction) fail('اتجاه النقل غير صالح.');
  const rows = await allBotMenuItems();
  const current = rows.find((row) => Number(row.id) === id);
  if (!current) fail('الزر المطلوب غير موجود.', 'NOT_FOUND');
  const siblings = rows.filter((row) => (row.parentId == null ? null : Number(row.parentId)) === (current.parentId == null ? null : Number(current.parentId)));
  const index = siblings.findIndex((row) => Number(row.id) === id);
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return { id, moved: false };
  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  const now = Date.now();
  for (let position = 0; position < siblings.length; position++) {
    await db.update(botMenuItems).set({ sortOrder: (position + 1) * 10, updatedAt: now })
      .where(eq(botMenuItems.id, Number(siblings[position].id))).run();
  }
  await audit(auth, 'move', 'bot_menu_item', id, { direction: direction < 0 ? 'up' : 'down', parentId: current.parentId });
  return { id, moved: true };
}

async function importModelJson(auth, input) {
  if (!auth.isOwner) fail('استيراد النماذج من JSON مخصص للمدير الرئيسي فقط.', 'FORBIDDEN');
  const courseId = positiveId(input.courseId, 'المادة');
  const sourceYear = Number(input.sourceYear);
  if (!Number.isSafeInteger(sourceYear) || sourceYear < 0 || sourceYear > 2100) fail('سنة النموذج غير صالحة.');
  const sourceFile = cleanString(input.sourceFile, 'اسم النموذج', 500);
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 500) fail('عدد الأسئلة يجب أن يكون من 1 إلى 500.');
  const catalog = await supabaseContentRequest('dashboard', {}, auth);
  if (!(catalog.courses || []).some((row) => Number(row.id) === courseId)) fail('المادة المحددة غير موجودة.', 'NOT_FOUND');
  const normalized = input.questions.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('بيانات السؤال رقم ' + (index + 1) + ' غير صالحة.');
    const questionText = cleanString(raw.questionText ?? raw.question ?? raw.text, 'نص السؤال ' + (index + 1), 3000);
    const rawOptions = raw.options ?? raw.choices;
    if (!Array.isArray(rawOptions)) fail('خيارات السؤال رقم ' + (index + 1) + ' يجب أن تكون مصفوفة.');
    const options = rawOptions.map((option) => cleanString(typeof option === 'string' ? option : (option?.text ?? option?.label ?? option?.value), 'الخيار', 500)).filter(Boolean);
    if (options.length < 2 || options.length > 8) fail('السؤال رقم ' + (index + 1) + ' يجب أن يحتوي من خيارين إلى 8 خيارات.');
    const answer = raw.correctIndex ?? raw.correctAnswer ?? raw.answerIndex ?? raw.answer;
    let correctIndex = typeof answer === 'string' && !/^\d+$/.test(answer)
      ? options.findIndex((option) => option === answer.trim()) : Number(answer);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) fail('الإجابة الصحيحة للسؤال رقم ' + (index + 1) + ' غير صالحة؛ استخدم فهرسًا يبدأ من 0 أو نص الخيار.');
    return {
      courseId, sourceYear, sourceFile, questionText, options, correctIndex,
      explanation: String(raw.explanation ?? raw.explain ?? '').slice(0, 1500),
      difficulty: ['easy', 'normal', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'normal',
      sortOrder: Number.isSafeInteger(Number(raw.sortOrder)) && Number(raw.sortOrder) >= 0 ? Number(raw.sortOrder) : index + 1,
    };
  });
  for (const question of normalized) await supabaseContentRequest('saveQuestion', question, auth);
  await audit(auth, 'import_json', 'model', 0, { courseId, sourceYear, sourceFile, imported: normalized.length });
  return { imported: normalized.length, courseId, sourceYear, sourceFile };
}

export default async function (input = {}, ctx) {
  const auth = await authorize(ctx);
  const action = typeof input.action === 'string' ? input.action : '';

  if (action === 'checkAccess') {
    return { allowed: true, isOwner: auth.isOwner, telegramId: auth.telegramId };
  }
  if (action === 'getMaintenance') {
    if (!auth.isOwner) fail('إعداد الصيانة مخصص للمدير الرئيسي فقط.', 'FORBIDDEN');
    const row = await db.select().from(siteSettings).where(eq(siteSettings.key, 'maintenance')).get();
    return row?.value && typeof row.value === 'object'
      ? row.value
      : { enabled: false, message: '', updatedAt: null };
  }
  if (action === 'setMaintenance') {
    if (!auth.isOwner) fail('إعداد الصيانة مخصص للمدير الرئيسي فقط.', 'FORBIDDEN');
    if (typeof input.enabled !== 'boolean') fail('حالة الصيانة غير صالحة.');
    const message = cleanString(input.message || 'الموقع تحت الصيانة حاليًا. نعمل على تحسين الخدمة، يرجى العودة لاحقًا.', 'رسالة الصيانة', 500);
    const value = { enabled: input.enabled, message, updatedAt: Date.now() };
    await db.insert(siteSettings).values({
      key: 'maintenance', value, updatedAt: value.updatedAt, updatedBy: auth.telegramId,
    }).onConflictDoUpdate({
      target: siteSettings.key,
      set: { value, updatedAt: value.updatedAt, updatedBy: auth.telegramId },
    }).run();
    await audit(auth, input.enabled ? 'maintenance_on' : 'maintenance_off', 'site_settings', 0, { enabled: input.enabled });
    return value;
  }
  if (action === 'dashboard') return rowsForDashboard(auth);
  if (action === 'questionsPage') return rowsForQuestionsPage(auth, input);
  if (action === 'listStudents') {
    if (!auth.isOwner && !allowed(auth, 'students.read')) fail('لا تملك صلاحية عرض حسابات الطلاب.', 'FORBIDDEN');
    return await supabaseContentRequest('listStudents', {}, auth);
  }
  if (action === 'setStudentStatus') {
    if (!auth.isOwner) fail('إيقاف حسابات الطلاب متاح للمدير الرئيسي فقط.', 'FORBIDDEN');
    const result = await supabaseContentRequest('setStudentStatus', {
      userId: input.userId,
      status: input.status,
    }, auth);
    await audit(auth, input.status === 'suspended' ? 'student_suspend' : 'student_reactivate', 'student', 0, {
      username: result.username,
      status: result.status,
    });
    return result;
  }

  if (action === 'saveLevel') return saveLevel(auth, input);
  if (action === 'setLevelActive') return setLevelActive(auth, input);
  if (action === 'saveSubject') return saveSubject(auth, input);
  if (action === 'setSubjectActive') return setSubjectActive(auth, input);
  if (action === 'saveCourse') return saveCourse(auth, input);
  if (action === 'setCourseActive') return setCourseActive(auth, input);
  if (action === 'saveQuestion') return saveQuestion(auth, input);
  if (action === 'importModelJson') return importModelJson(auth, input);
  if (action === 'setQuestionActive') return setQuestionActive(auth, input);
  if (action === 'renameModel') return renameModel(auth, input);
  if (action === 'setModelActive') return setModelActive(auth, input);
  if (action === 'saveModerator') return saveModerator(auth, input);
  if (action === 'setModeratorActive') return setModeratorActive(auth, input);
  if (action === 'listBotMenuItems') return listBotMenuForAdmin(auth);
  if (action === 'saveBotMenuItem') return saveBotMenuItem(auth, input);
  if (action === 'deleteBotMenuItem') return deleteBotMenuItem(auth, input);
  if (action === 'toggleBotMenuItem') return toggleBotMenuItem(auth, input);
  if (action === 'moveBotMenuItem') return moveBotMenuItem(auth, input);

  fail('العملية المطلوبة غير معروفة.', 'UNKNOWN_ACTION');
}
