import { db, EndpointError } from 'sdk';
import { desc, eq } from 'sdk/db';
import {
  moderators,
  auditLogs,
  botMenuItems,
  siteSettings,
  visitorStats,
  questionReports,
  questionApprovalRequests,
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

async function visitorAnalyticsForOwner(auth) {
  if (!auth.isOwner) fail('عرض بيانات الزوار مخصص للمالك الأساسي فقط.', 'FORBIDDEN');
  const rows = await db.select().from(visitorStats).all();
  const now = Date.now();
  const activeCutoff = now - 90_000;
  // Ignore legacy anonymous browser records: they cannot be reliably matched to a Telegram identity.
  const identifiedRows = rows.filter((row) => Number.isSafeInteger(Number(row.telegramId)) && Number(row.telegramId) > 0);
  const newestFirst = [...identifiedRows].sort((a, b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
  return {
    totalVisitors: identifiedRows.length,
    currentUsers: identifiedRows.filter((row) => Number(row.lastSeen || 0) >= activeCutoff).length,
    updatedAt: now,
    visitors: newestFirst.slice(0, 75).map((row) => ({
      accountUsername: String(row.accountUsername || ''),
      displayName: String(row.displayName || ''),
      accountSessionActive: row.accountSessionActive === true || Number(row.accountSessionActive) === 1,
      telegramUsername: String(row.telegramUsername || ''),
      telegramName: String(row.telegramName || ''),
      telegramId: row.telegramId == null ? '' : String(row.telegramId),
      firstSeen: Number(row.firstSeen || 0),
      lastSeen: Number(row.lastSeen || 0),
      visitCount: Number(row.visitCount || 1),
      isOnline: Number(row.lastSeen || 0) >= activeCutoff,
    })),
  };
}

async function rowsForDashboard(auth) {
  // Model totals are grouped from the source question records below. The summary-only response deliberately omits questions, which made every model count appear as zero in the hierarchy.
  const content = await supabaseContentRequest('dashboardSummary', {}, auth);
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
  if (Array.isArray(content.models)) {
    for (const row of content.models) {
      if (!canAccessCourse(auth, Number(row.courseId))) continue;
      const courseId = Number(row.courseId), sourceYear = Number(row.sourceYear) || 0, sourceFile = String(row.sourceFile ?? '');
      const id = String(row.id || encodeURIComponent(JSON.stringify([courseId, sourceYear, sourceFile])));
      modelMap.set(id, {
        id, courseId, sourceYear, sourceFile,
        total: Number(row.total) || 0, activeCount: Number(row.activeCount) || 0,
        isActive: Number(row.activeCount) > 0,
      });
    }
  } else {
    for (const q of visibleQuestions) {
      const sourceYear = Number(q.sourceYear) || 0;
      const sourceFile = String(q.sourceFile ?? '');
      const id = encodeURIComponent(JSON.stringify([Number(q.courseId), sourceYear, sourceFile]));
      if (!modelMap.has(id)) modelMap.set(id, { id, courseId: Number(q.courseId), sourceYear, sourceFile, total: 0, activeCount: 0, isActive: false });
      const model = modelMap.get(id);
      model.total++;
      if (q.isActive) model.activeCount++;
      model.isActive = model.activeCount > 0;
    }
  }
  const modelOrderRow = await db.select().from(siteSettings).where(eq(siteSettings.key, 'academic_model_order')).get();
  const savedModelOrders = modelOrderRow?.value && typeof modelOrderRow.value === 'object' ? modelOrderRow.value : {};
  const modelOrderByKey = new Map();
  for (const [levelId, keys] of Object.entries(savedModelOrders)) {
    if (Array.isArray(keys)) keys.forEach((key, index) => modelOrderByKey.set(`${levelId}:${key}`, index));
  }
  const levelByCourse = new Map(allCourses.map((course) => {
    const subject = allSubjects.find((row) => Number(row.id) === Number(course.subjectId));
    return [Number(course.id), Number(subject?.levelId || 0)];
  }));
  const visibleModels = [...modelMap.values()].sort((a, b) => {
    const levelA = levelByCourse.get(a.courseId) || 0, levelB = levelByCourse.get(b.courseId) || 0;
    if (levelA !== levelB) return levelA - levelB;
    const keyA = `${a.courseId}|${a.sourceYear}|${a.sourceFile}`;
    const keyB = `${b.courseId}|${b.sourceYear}|${b.sourceFile}`;
    const orderA = modelOrderByKey.get(`${levelA}:${keyA}`), orderB = modelOrderByKey.get(`${levelB}:${keyB}`);
    if (orderA != null || orderB != null) {
      if (orderA == null) return 1;
      if (orderB == null) return -1;
      if (orderA !== orderB) return orderA - orderB;
    }
    return a.courseId - b.courseId || b.sourceYear - a.sourceYear || a.sourceFile.localeCompare(b.sourceFile, 'ar');
  });

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
  let visitorAnalytics = null;
  if (auth.isOwner || allowed(auth, 'statistics.read')) {
    const statCourses = allCourses.filter((row) => canAccessCourse(auth, row.id));
    const statCourseIds = new Set(statCourses.map((row) => row.id));
    const statSubjects = allSubjects.filter((row) => statCourses.some((course) => course.subjectId === row.id));
    const statLevelIds = new Set(statSubjects.map((row) => row.levelId));
    const statQuestions = allQuestions.filter((row) => statCourseIds.has(row.courseId));
    stats.levels = allLevels.filter((row) => statLevelIds.has(row.id)).length;
    stats.subjects = statSubjects.length;
    stats.courses = statCourses.length;
    const scopedModels = visibleModels.filter((model) => statCourseIds.has(Number(model.courseId)));
    stats.questions = compactQuestionCounts && (auth.isOwner || auth.scopeCourseIds.includes('*'))
      ? Number(content.questionCount)
      : Array.isArray(content.models) ? scopedModels.reduce((sum, model) => sum + Number(model.total || 0), 0) : statQuestions.length;
    stats.activeQuestions = compactQuestionCounts && (auth.isOwner || auth.scopeCourseIds.includes('*'))
      ? Number(content.activeQuestionCount)
      : Array.isArray(content.models) ? scopedModels.reduce((sum, model) => sum + Number(model.activeCount || 0), 0) : statQuestions.filter((row) => row.isActive).length;
    stats.moderators = auth.isOwner ? visibleModerators.filter((row) => row.isActive).length : null;
    if (auth.isOwner) {
      visitorAnalytics = await visitorAnalyticsForOwner(auth);
      stats.totalVisitors = visitorAnalytics.totalVisitors;
      stats.currentUsers = visitorAnalytics.currentUsers;
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
      ? Number(content.questionCount)
      : Array.isArray(content.models) ? visibleModels.reduce((sum, model) => sum + Number(model.total || 0), 0) : visibleQuestions.length,
    models: visibleModels,
    moderators: visibleModerators,
    logs,
    stats,
    visitorAnalytics: auth.isOwner ? visitorAnalytics : null,
    canManageModerators: auth.isOwner,
    canManageCatalog: auth.isOwner || auth.scopeCourseIds.includes('*'),
  };
}

async function rowsForQuestionsPage(auth, input = {}) {
  const canSeeQuestions = ['questions.read', 'questions.write', 'questions.publish', 'questions.delete']
    .some((permission) => allowed(auth, permission));
  if (!canSeeQuestions) fail('لا تملك صلاحية عرض الأسئلة.', 'FORBIDDEN');
  const query = cleanString(input.query || '', 'عبارة البحث', 250, false).toLocaleLowerCase('ar');
  const model = input.model && typeof input.model === 'object' ? input.model : null;
  const pageSize = Math.max(1, Math.min(25, Number.isSafeInteger(Number(input.pageSize)) ? Number(input.pageSize) : 25));
  const page = Math.max(1, Number.isSafeInteger(Number(input.page)) ? Number(input.page) : 1);

  // The edge function applies course scope and SQL-side filters, returning only this page.
  // Do not fetch the full question bank into TGCloud and filter it in memory.
  const result = await supabaseContentRequest('questionsPage', {
    page, pageSize, query, reviewOnly: input.reviewOnly === true,
    model: model ? {
      courseId: Number(model.courseId),
      sourceYear: Number(model.sourceYear || 0),
      sourceFile: String(model.sourceFile || 'بلا اسم'),
    } : null,
  }, auth);
  return result;
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


async function moveCourseWithinLevel(auth, input) {
  requirePermission(auth, 'courses.write');
  requireGlobalCatalogScope(auth);
  const courseId = positiveId(input.courseId, 'المقرر');
  const direction = input.direction === 'up' ? -1 : input.direction === 'down' ? 1 : 0;
  if (!direction) fail('اتجاه الترتيب غير صالح.');
  const content = await supabaseContentRequest('dashboard', {}, auth);
  const courses = content.courses || [], subjects = content.subjects || [];
  const selected = courses.find((row) => Number(row.id) === courseId);
  if (!selected) fail('المقرر غير موجود؛ حدّث لوحة الإدارة.', 'NOT_FOUND');
  const parent = subjects.find((row) => Number(row.id) === Number(selected.subjectId));
  if (!parent) fail('تعذر تحديد مستوى المقرر.', 'NOT_FOUND');
  const levelId = Number(parent.levelId);
  const siblings = courses.filter((row) =>
    Number(row.subjectId) === Number(selected.subjectId) && Boolean(row.isActive) === Boolean(selected.isActive)
  ).sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'ar'));
  const index = siblings.findIndex((row) => Number(row.id) === courseId);
  const target = index + direction;
  if (index < 0) fail('تعذر تحديد موضع المقرر.', 'NOT_FOUND');
  if (target < 0 || target >= siblings.length) return { moved: false, reason: 'edge' };
  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  for (let i = 0; i < siblings.length; i++) {
    const row = siblings[i];
    await supabaseContentRequest('saveCourse', { id: Number(row.id), subjectId: Number(row.subjectId), name: String(row.name || ''), description: String(row.description || ''), durationMinutes: Number(row.durationMinutes || 60), passingScore: Number(row.passingScore ?? 50), sortOrder: (i + 1) * 10 }, auth);
  }
  await audit(auth, 'reorder', 'course', courseId, { levelId, direction: direction < 0 ? 'up' : 'down' });
  return { moved: true, courseId, subjectId: Number(selected.subjectId), levelId };
}

async function setCourseActive(auth, input) {
  requirePermission(auth, 'courses.write');
  requireGlobalCatalogScope(auth);
  const result = await supabaseContentRequest('setCourseActive', input, auth);
  await audit(auth, result.isActive ? 'activate' : 'archive', 'course', result.id, { isActive: result.isActive });
  return result;
}

async function submitQuestionApproval(auth, input) {
  requirePermission(auth, 'questions.write');
  const courseId = positiveId(input.courseId, 'المقرر');
  requireCourseScope(auth, courseId);
  const id = input.id ? positiveId(input.id, 'السؤال') : null;
  const questionText = cleanString(input.questionText, 'نص السؤال', 3000);
  const sourceFile = cleanString(input.sourceFile, 'اسم النموذج', 500);
  const options = Array.isArray(input.options) ? input.options.map((value) => typeof value === 'string' ? value.trim() : '') : [];
  const correctIndex = Number(input.correctIndex);
  if (options.length < 2 || options.length > 8 || options.some((value) => !value || value.length > 500)) fail('يجب إدخال خيارين إلى ثمانية خيارات غير فارغة.');
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) fail('حدد الإجابة الصحيحة قبل إرسال السؤال للاعتماد.');
  let beforeSnapshot = null;
  let baseUpdatedAt = '';
  if (id) {
    const content = await supabaseContentRequest('dashboard', {}, auth);
    beforeSnapshot = (content.questions || []).find((row) => Number(row.id) === id) || null;
    if (!beforeSnapshot) fail('السؤال الأصلي لم يعد موجودًا. حدّث قائمة الأسئلة ثم أعد المحاولة.', 'NOT_FOUND');
    requireCourseScope(auth, Number(beforeSnapshot.courseId));
    baseUpdatedAt = String(beforeSnapshot.updatedAt || '');
    if (input.baseUpdatedAt && baseUpdatedAt && String(input.baseUpdatedAt) !== baseUpdatedAt) {
      fail('تغيّر السؤال منذ فتح نموذج التعديل. أعد فتحه حتى لا يُستبدل تعديل أحدث.', 'STALE_QUESTION');
    }
  }
  const requestType = id ? 'update' : 'create';
  const questionId = id ? String(id) : '';
  const existing = await db.select().from(questionApprovalRequests).where(eq(questionApprovalRequests.status, 'pending')).all();
  if (existing.some((row) => row.requestType === requestType && Number(row.courseId) === courseId && (id ? String(row.questionId) === questionId : String(row.payload?.questionText || '') === questionText))) {
    fail('يوجد طلب اعتماد قيد المراجعة لهذا السؤال بالفعل.', 'APPROVAL_ALREADY_PENDING');
  }
  const payload = {
    ...(id ? { id } : {}), courseId,
    sourceYear: Number.isInteger(Number(input.sourceYear)) ? Number(input.sourceYear) : 0,
    sourceFile, questionText, options, correctIndex,
    explanation: cleanString(input.explanation || '', 'التوضيح', 1500, false),
    sortOrder: Number.isSafeInteger(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
  };
  const now = Date.now();
  const request = {
    id: crypto.randomUUID(), requestType, questionId, courseId, payload, beforeSnapshot,
    baseUpdatedAt, status: 'pending', submittedBy: auth.telegramId,
    submitterName: auth.actorName, submittedAt: now, reviewerId: null,
    reviewerName: '', reviewedAt: null, decisionNote: '', appliedQuestionId: null,
  };
  await db.insert(questionApprovalRequests).values(request).run();
  await audit(auth, 'question_change_submitted', 'question_approval_request', 0, { requestId: request.id, requestType, questionId, courseId });
  return { ok: true, submitted: true, requestId: request.id, requestType };
}
async function listQuestionApprovalRequests(auth) {
  requirePermission(auth, 'questions.publish');
  const rows = await db.select().from(questionApprovalRequests).orderBy(desc(questionApprovalRequests.submittedAt)).all();
  const visible = auth.isOwner || auth.scopeCourseIds.includes('*')
    ? rows : rows.filter((row) => auth.scopeCourseIds.includes(Number(row.courseId)));
  return { requests: visible.slice(0, 500) };
}
async function approveQuestionRequest(auth, input) {
  requirePermission(auth, 'questions.publish');
  const id = cleanString(input.id, 'معرّف طلب الاعتماد', 100);
  const request = await db.select().from(questionApprovalRequests).where(eq(questionApprovalRequests.id, id)).get();
  if (!request) fail('طلب الاعتماد غير موجود.', 'NOT_FOUND');
  requireCourseScope(auth, request.courseId);
  if (request.status !== 'pending') fail('تم اتخاذ قرار في هذا الطلب مسبقًا.');
  if (request.requestType === 'update') {
    const content = await supabaseContentRequest('dashboard', {}, auth);
    const current = (content.questions || []).find((row) => String(row.id) === String(request.questionId));
    if (!current) fail('السؤال الأصلي لم يعد موجودًا؛ ارفض الطلب أو اطلب من المحرر تقديم طلب جديد.', 'QUESTION_DISAPPEARED');
    if (request.baseUpdatedAt && String(current.updatedAt || '') !== String(request.baseUpdatedAt)) {
      fail('تغيّر السؤال بعد إرسال الطلب. لم تُطبّق التعديلات؛ أعد فتح السؤال وأرسل نسخة محدثة.', 'STALE_APPROVAL');
    }
  }
  const saved = await supabaseContentRequest('approveQuestionChange', { question: request.payload }, auth);
  const appliedQuestionId = Number(saved?.saved?.id || request.questionId || 0) || null;
  const reviewedAt = Date.now();
  await db.update(questionApprovalRequests).set({
    status: 'approved', reviewerId: auth.telegramId, reviewerName: auth.actorName,
    reviewedAt, decisionNote: cleanString(input.decisionNote || 'تمت المراجعة العلمية والاعتماد.', 'ملاحظة الاعتماد', 1000, false),
    appliedQuestionId,
  }).where(eq(questionApprovalRequests.id, id)).run();
  await audit(auth, 'question_change_approved', 'question_approval_request', 0, { requestId: id, questionId: appliedQuestionId, requestType: request.requestType });
  return { ok: true, approved: true, questionId: appliedQuestionId };
}
async function rejectQuestionRequest(auth, input) {
  requirePermission(auth, 'questions.publish');
  const id = cleanString(input.id, 'معرّف طلب الاعتماد', 100);
  const note = cleanString(input.decisionNote, 'سبب الرفض', 1000);
  const request = await db.select().from(questionApprovalRequests).where(eq(questionApprovalRequests.id, id)).get();
  if (!request) fail('طلب الاعتماد غير موجود.', 'NOT_FOUND');
  requireCourseScope(auth, request.courseId);
  if (request.status !== 'pending') fail('تم اتخاذ قرار في هذا الطلب مسبقًا.');
  const reviewedAt = Date.now();
  await db.update(questionApprovalRequests).set({ status: 'rejected', reviewerId: auth.telegramId, reviewerName: auth.actorName, reviewedAt, decisionNote: note }).where(eq(questionApprovalRequests.id, id)).run();
  await audit(auth, 'question_change_rejected', 'question_approval_request', 0, { requestId: id, questionId: request.questionId, note });
  return { ok: true, rejected: true };
}

async function saveQuestion(auth, input) {
  requirePermission(auth, 'questions.write');
  requireCourseScope(auth, positiveId(input.courseId, 'المقرر'));
  if (!allowed(auth, 'questions.publish')) return submitQuestionApproval(auth, input);
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
async function updateLinkedBotModelButtons(oldModel, newModel) {
  const items = await db.select().from(botMenuItems).all();
  let updated = 0;
  for (const item of items) {
    if (item.type !== 'catalog' || !item.value) continue;
    let target;
    try { target = JSON.parse(item.value); } catch { continue; }
    if (target?.targetType !== 'model') continue;
    const linkedCourse = Number(target.courseId ?? target.targetId);
    if (linkedCourse !== Number(oldModel.courseId) ||
        Number(target.sourceYear || 0) !== Number(oldModel.sourceYear || 0) ||
        String(target.sourceFile || '') !== String(oldModel.sourceFile || '')) continue;
    const nextTarget = {
      ...target,
      targetId: Number(newModel.courseId),
      courseId: Number(newModel.courseId),
      sourceYear: Number(newModel.sourceYear || 0),
      sourceFile: String(newModel.sourceFile || ''),
    };
    await db.update(botMenuItems)
      .set({ value: JSON.stringify(nextTarget), updatedAt: Date.now() })
      .where(eq(botMenuItems.id, Number(item.id))).run();
    updated += 1;
  }
  return updated;
}

async function updateModel(auth, input) {
  requirePermission(auth, 'questions.write');
  const courseId = positiveId(input.courseId, 'المقرر الحالي');
  const targetCourseId = positiveId(input.targetCourseId ?? input.courseId, 'المقرر الجديد');
  requireCourseScope(auth, courseId); requireCourseScope(auth, targetCourseId);
  const sourceYear = Number(input.sourceYear) || 0, newSourceYear = Number(input.newSourceYear);
  const sourceFile = cleanString(input.sourceFile, 'اسم النموذج الحالي', 500);
  const newSourceFile = cleanString(input.newSourceFile, 'اسم النموذج الجديد', 500);
  if (!Number.isSafeInteger(newSourceYear) || newSourceYear < 0 || newSourceYear > 2100) fail('سنة النموذج الجديدة غير صالحة.');
  const content = await supabaseContentRequest('dashboard', {}, auth);
  const qs = content.questions || [];
  const source = q => Number(q.courseId) === courseId && Number(q.sourceYear || 0) === sourceYear && String(q.sourceFile || 'بلا اسم') === sourceFile;
  const modelQuestions = qs.filter(source);
  if (!modelQuestions.length) fail('لم يُعثر على أسئلة هذا النموذج.', 'NOT_FOUND');
  if (!(content.courses || []).some(c => Number(c.id) === targetCourseId)) fail('المقرر الجديد غير موجود.', 'NOT_FOUND');
  const unchanged = targetCourseId === courseId && newSourceYear === sourceYear && newSourceFile === sourceFile;
  if (!unchanged && qs.some(q => !source(q) && Number(q.courseId) === targetCourseId && Number(q.sourceYear || 0) === newSourceYear && String(q.sourceFile || 'بلا اسم') === newSourceFile)) fail('يوجد نموذج بالاسم والسنة نفسيهما في المقرر الهدف؛ غيّر الاسم أو السنة أولًا.', 'MODEL_CONFLICT');
  let result;
  if (targetCourseId === courseId && sourceYear !== 0 && sourceFile !== 'بلا اسم') {
    result = await supabaseContentRequest('renameModel', { courseId, sourceYear, sourceFile, newSourceYear, newSourceFile }, auth);
  } else {
    const saved = [];
    const change = (q, course, year, file) => supabaseContentRequest('saveQuestion', { id:q.id, courseId:course, sourceYear:year, sourceFile:file, sourceIndex:q.sourceIndex == null ? Number(q.sortOrder || 0)+1 : Number(q.sourceIndex), sortOrder:Number(q.sortOrder || 0), questionText:q.questionText, options:q.options, correctIndex:q.correctIndex, explanation:q.explanation || '', difficulty:q.difficulty || 'normal' }, auth);
    for (let i=0; i<modelQuestions.length; i+=8) {
      const batch=modelQuestions.slice(i,i+8);
      const outcomes=await Promise.allSettled(batch.map(q=>change(q,targetCourseId,newSourceYear,newSourceFile)));
      outcomes.forEach((o,j)=>{if(o.status==='fulfilled')saved.push(batch[j]);});
      if(outcomes.some(o=>o.status==='rejected')) {
        const rollback=await Promise.allSettled(saved.map(q=>change(q,Number(q.courseId),Number(q.sourceYear||0),String(q.sourceFile??''))));
        if(rollback.some(o=>o.status==='rejected')) fail('تعذر إكمال النقل أو استعادة بعض الأسئلة. راجع النموذج قبل إعادة المحاولة.', 'MODEL_MOVE_PARTIAL');
        fail('تعذر نقل النموذج؛ أُعيدت الأسئلة التي نُقلت بنجاح إلى المقرر السابق.', 'MODEL_MOVE_FAILED');
      }
    }
    result={updated:saved.length,courseId,targetCourseId,sourceYear:newSourceYear,sourceFile:newSourceFile};
  }
  const newModel = {
    courseId: Number(targetCourseId),
    sourceYear: Number(result.sourceYear ?? newSourceYear),
    sourceFile: String(result.sourceFile ?? newSourceFile),
  };
  const linkedButtonsUpdated = await updateLinkedBotModelButtons(
    { courseId, sourceYear, sourceFile },
    newModel,
  );
  await audit(auth, targetCourseId===courseId?'rename':'move', 'model', 0, {
    courseId,targetCourseId,oldYear:sourceYear,oldFile:sourceFile,
    newYear:newModel.sourceYear,newFile:newModel.sourceFile,
    updated:result.updated,linkedButtonsUpdated,
  });
  return { ...result, linkedButtonsUpdated };
}

async function moveModelWithinLevel(auth, input) {
  requirePermission(auth, 'questions.write');
  const modelKey = cleanString(input.modelKey, 'النموذج', 1000);
  const direction = input.direction === 'up' ? -1 : input.direction === 'down' ? 1 : 0;
  if (!direction) fail('اتجاه الترتيب غير صالح.');
  const content = await supabaseContentRequest('dashboard', {}, auth);
  const courses = content.courses || [], subjects = content.subjects || [], questions = content.questions || [];
  const map = new Map();
  for (const q of questions) {
    const sourceYear = Number(q.sourceYear) || 0, sourceFile = String(q.sourceFile ?? '');
    const key = `${Number(q.courseId)}|${sourceYear}|${sourceFile}`;
    if (!map.has(key)) map.set(key, { key, courseId: Number(q.courseId), sourceYear, sourceFile });
  }
  const selected = map.get(modelKey);
  if (!selected) fail('النموذج غير موجود؛ حدّث لوحة الإدارة.', 'NOT_FOUND');
  requireCourseScope(auth, selected.courseId);
  const levelForCourse = (courseId) => {
    const course = courses.find((row) => Number(row.id) === Number(courseId));
    return Number(subjects.find((row) => Number(row.id) === Number(course?.subjectId))?.levelId || 0);
  };
  const levelId = levelForCourse(selected.courseId);
  const siblings = [...map.values()].filter((row) => levelForCourse(row.courseId) === levelId);
  for (const row of siblings) requireCourseScope(auth, row.courseId);
  const setting = await db.select().from(siteSettings).where(eq(siteSettings.key, 'academic_model_order')).get();
  const orders = setting?.value && typeof setting.value === 'object' ? { ...setting.value } : {};
  const stored = Array.isArray(orders[String(levelId)]) ? orders[String(levelId)] : [];
  const keys = [...stored.filter((key) => siblings.some((row) => row.key === key)), ...siblings.map((row) => row.key).filter((key) => !stored.includes(key))];
  const index = keys.indexOf(modelKey), target = index + direction;
  if (index < 0) fail('تعذر تحديد موضع النموذج.', 'NOT_FOUND');
  if (target < 0 || target >= keys.length) return { moved: false, reason: 'edge' };
  [keys[index], keys[target]] = [keys[target], keys[index]];
  orders[String(levelId)] = keys;
  const now = Date.now();
  await db.insert(siteSettings).values({ key: 'academic_model_order', value: orders, updatedAt: now, updatedBy: auth.telegramId })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: orders, updatedAt: now, updatedBy: auth.telegramId } }).run();
  await audit(auth, 'reorder', 'model', 0, { levelId, modelKey, direction: direction < 0 ? 'up' : 'down' });
  return { moved: true, levelId, modelKey };
}

async function deleteModel(auth, input) {
  requirePermission(auth, 'questions.delete');
  const courseId = positiveId(input.courseId, 'المقرر'); requireCourseScope(auth, courseId);
  const sourceYear = Number(input.sourceYear) || 0;
  const sourceFile = cleanString(input.sourceFile, 'اسم النموذج', 500);
  const content = await supabaseContentRequest('dashboard', {}, auth);
  const questions = (content.questions || []).filter(q => Number(q.courseId) === courseId && Number(q.sourceYear || 0) === sourceYear && String(q.sourceFile || 'بلا اسم') === sourceFile);
  if (!questions.length) fail('لم يُعثر على أسئلة هذا النموذج.', 'NOT_FOUND');
  // Keep source rows for recovery and history; remove every question in the group from the student-facing bank.
  let result = null;
  try { result = await supabaseContentRequest('setModelActive', { courseId, sourceYear, sourceFile, isActive: false }, auth); } catch (_) { /* fallback below handles legacy null source_year values */ }
  if (Number(result?.updated || 0) !== questions.length) {
    const activeQuestions = questions.filter(q => q.isActive);
    const outcomes = await Promise.allSettled(activeQuestions.map(q => supabaseContentRequest('setQuestionActive', { id: q.id, isActive: false }, auth)));
    if (outcomes.some(entry => entry.status === 'rejected')) fail('تعذرت أرشفة جميع أسئلة النموذج؛ أعد المحاولة بعد تحديث البيانات.', 'MODEL_ARCHIVE_PARTIAL');
  }
  await audit(auth, 'archive', 'model', 0, { courseId, sourceYear, sourceFile, archivedQuestions: questions.length });
  return { archived: true, archivedQuestions: questions.length };
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

function encodeModelSourceFile(name, system, audience) {
  const cleanName = cleanString(name, 'اسم النموذج', 400);
  const cleanSystem = cleanString(system, 'النظام الدراسي', 80).replace(/[⟦⟧]/g, '').trim();
  const cleanAudience = cleanString(audience, 'الفئة المستهدفة', 20);
  if (!cleanSystem) fail('اسم النظام الدراسي مطلوب.');
  if (!['طلاب', 'طالبات'].includes(cleanAudience)) fail('الفئة المستهدفة يجب أن تكون طلاب أو طالبات.');
  const tagged = '⟦نظام:' + cleanSystem + '⟧⟦الفئة:' + cleanAudience + '⟧ ' + cleanName;
  if (tagged.length > 500) fail('اسم النموذج مع النظام والفئة أطول من المسموح.');
  return tagged;
}

async function recordBackupExport(auth, input) {
  if (!auth.isOwner) fail('تصدير النسخة الاحتياطية مخصص للمدير الرئيسي فقط.', 'FORBIDDEN');
  const count = (value, label) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 10000000) fail('عدد ' + label + ' غير صالح.');
    return n;
  };
  const counts = {
    levels: count(input.levelCount, 'المستويات'),
    subjects: count(input.subjectCount, 'المواد'),
    courses: count(input.courseCount, 'المقررات'),
    questions: count(input.questionCount, 'الأسئلة'),
  };
  await audit(auth, 'export', 'content_backup', 0, counts);
  return { recorded: true, counts };
}

async function importModelJson(auth, input) {
  if (!auth.isOwner) fail('استيراد النماذج من JSON مخصص للمدير الرئيسي فقط.', 'FORBIDDEN');
  const levelId = positiveId(input.levelId, 'المستوى');
  const courseId = positiveId(input.courseId, 'المقرر');
  const sourceYear = Number(input.sourceYear);
  if (!Number.isSafeInteger(sourceYear) || sourceYear < 2020 || sourceYear > 2025) fail('سنة النموذج يجب أن تكون من 2020 إلى 2025.');
  const sourceSystem = cleanString(input.sourceSystem, 'النظام الدراسي', 80);
  if (sourceSystem === '__other__') fail('اكتب اسم النظام الآخر بدلًا من ترك الخيار الافتراضي.');
  const sourceAudience = cleanString(input.sourceAudience, 'الفئة المستهدفة', 20);
  const allowedPeriods = ['الفترة الأولى', 'الفترة الثانية', 'الفترة الثالثة', 'الفترة الرابعة', 'الفترة الخامسة'];
  const modelPeriod = cleanString(input.sourceFile, 'الفترة', 80);
  if (!allowedPeriods.includes(modelPeriod)) fail('فترة النموذج غير صالحة؛ اختر فترة من الأولى إلى الخامسة.');
  const sourceFile = encodeModelSourceFile(modelPeriod, sourceSystem, sourceAudience);
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 500) fail('عدد الأسئلة يجب أن يكون من 1 إلى 500.');
  const catalog = await supabaseContentRequest('dashboard', {}, auth);
  const selectedCourse = (catalog.courses || []).find((row) => Number(row.id) === courseId);
  if (!selectedCourse) fail('المقرر المحدد غير موجود.', 'NOT_FOUND');
  if (selectedCourse.isActive === false) fail('لا يمكن إضافة نموذج إلى مقرر مؤرشف. فعّل المقرر أولًا.', 'COURSE_ARCHIVED');
  const sourceExists = (catalog.models || []).some((model) =>
    Number(model.courseId) === courseId &&
    Number(model.sourceYear) === sourceYear &&
    String(model.sourceFile || '') === sourceFile);
  if (sourceExists) fail('يوجد نموذج مسجل مسبقًا لهذه المادة والنظام والسنة والفترة. لن نكرر الأسئلة داخله.', 'MODEL_EXISTS');
  const selectedSubject = (catalog.subjects || []).find((row) => Number(row.id) === Number(selectedCourse.subjectId));
  if (!selectedSubject || Number(selectedSubject.levelId) !== levelId) fail('المقرر المختار لا يتبع المستوى المحدد.', 'COURSE_LEVEL_MISMATCH');
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
  // Save in small concurrent batches; sequential network round-trips made larger imports
  // exceed the Telegram WebApp callback timeout and appear to fail.
  const batchSize = 8;
  let imported = 0;
  for (let start = 0; start < normalized.length; start += batchSize) {
    const batch = normalized.slice(start, start + batchSize);
    await Promise.all(batch.map((question) => supabaseContentRequest('saveQuestion', question, auth)));
    imported += batch.length;
  }
  await audit(auth, 'import_json', 'model', 0, { levelId, courseId, sourceYear, sourceFile, sourceSystem, sourceAudience, imported });
  return { imported, courseId, sourceYear, sourceFile };
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
  if (action === 'submitQuestionForApproval') return submitQuestionApproval(auth, input);
  if (action === 'questionApprovalRequests') return listQuestionApprovalRequests(auth);
  if (action === 'approveQuestionRequest') return approveQuestionRequest(auth, input);
  if (action === 'rejectQuestionRequest') return rejectQuestionRequest(auth, input);
  if (action === 'questionReports') {
    requirePermission(auth, 'questions.read');
    // Import records from the first deployed version, which stored reports in a singleton setting.
    const legacyRow = await db.select().from(siteSettings).where(eq(siteSettings.key, 'question_reports')).get();
    const legacy = Array.isArray(legacyRow?.value?.reports) ? legacyRow.value.reports : [];
    for (const old of legacy) {
      if (!old?.id) continue;
      const exists = await db.select().from(questionReports).where(eq(questionReports.id, String(old.id))).get();
      if (exists) continue;
      await db.insert(questionReports).values({
        id:String(old.id), telegramId:Number(old.telegramId)||0, username:String(old.username||''),
        displayName:String(old.displayName||'طالب'), questionId:String(old.questionId||''),
        questionText:String(old.questionText||''), courseId:Number(old.courseId)||0,
        course:String(old.course||''), sourceYear:Number(old.sourceYear)||0,
        sourceFile:String(old.sourceFile||''), reportType:String(old.reportType||'other'),
        details:String(old.details||''), status:['open','in_review','needs_revision','resolved','rejected','duplicate'].includes(old.status)?old.status:'open',
        priority:['normal','high','urgent'].includes(old.priority)?old.priority:(['wrong_answer','question_error','choices_error'].includes(old.reportType)?'high':'normal'),
        assignedTo:Number(old.assignedTo)||null, assignedName:String(old.assignedName||''),
        resolutionNote:String(old.resolutionNote||''), resolutionCode:String(old.resolutionCode||''), duplicateOf:old.duplicateOf?String(old.duplicateOf):null,
        createdAt:Number(old.createdAt)||Date.now(), updatedAt:Number(old.updatedAt)||null,
        lastActionBy:Number(old.lastActionBy)||null, resolvedAt:old.resolvedAt?Number(old.resolvedAt):null,
        resolvedBy:old.resolvedBy?Number(old.resolvedBy):null,
      }).onConflictDoNothing().run();
    }
    const all = await db.select().from(questionReports).orderBy(desc(questionReports.createdAt)).all();
    const visible = auth.isOwner || auth.scopeCourseIds.includes('*')
      ? all : all.filter((r) => auth.scopeCourseIds.includes(Number(r.courseId)));
    return { reports: visible.slice(0, 500) };
  }
  if (action === 'claimQuestionReport') {
    requirePermission(auth, 'questions.write');
    const id = cleanString(input.id, 'معرّف البلاغ', 100);
    const found = await db.select().from(questionReports).where(eq(questionReports.id, id)).get();
    if (!found) fail('البلاغ غير موجود.');
    requireCourseScope(auth, found.courseId);
    if (['resolved','rejected','duplicate'].includes(found.status)) fail('لا يمكن استلام بلاغ مغلق؛ أعد فتحه أولًا.');
    if (found.assignedTo && Number(found.assignedTo) !== auth.telegramId && !auth.isOwner) {
      fail('البلاغ مسند إلى مشرف آخر. يمكن للمدير الرئيسي إعادة إسناده.', 'REPORT_ASSIGNED');
    }
    const now = Date.now();
    const status = found.status === 'open' ? 'in_review' : found.status;
    await db.update(questionReports).set({
      assignedTo:auth.telegramId, assignedName:auth.actorName, status,
      updatedAt:now, lastActionBy:auth.telegramId,
    }).where(eq(questionReports.id,id)).run();
    await audit(auth, 'question_report_claimed', 'question_report', 0, {reportId:id, questionId:found.questionId, status});
    return {ok:true, report:{...found,assignedTo:auth.telegramId,assignedName:auth.actorName,status,updatedAt:now,lastActionBy:auth.telegramId}};
  }
  if (action === 'updateQuestionReport') {
    requirePermission(auth, 'questions.write');
    const id = cleanString(input.id, 'معرّف البلاغ', 100);
    const nextStatus = cleanString(input.status, 'حالة البلاغ', 40);
    const validStatuses = new Set(['open','in_review','needs_revision','resolved','rejected','duplicate']);
    if (!validStatuses.has(nextStatus)) fail('حالة معالجة البلاغ غير معروفة.');
    const found = await db.select().from(questionReports).where(eq(questionReports.id, id)).get();
    if (!found) fail('البلاغ غير موجود.');
    requireCourseScope(auth, found.courseId);
    if (found.assignedTo && Number(found.assignedTo) !== auth.telegramId && !auth.isOwner) {
      fail('البلاغ مسند إلى مشرف آخر. لا يمكن تعديل عمل مشرف آخر.', 'REPORT_ASSIGNED');
    }
    const terminal = ['resolved','rejected','duplicate'];
    if (terminal.includes(found.status) && nextStatus !== 'open' && nextStatus !== found.status) {
      fail('أعد فتح البلاغ أولًا قبل تغيير مساره.');
    }
    if (terminal.includes(found.status) && nextStatus === found.status) fail('هذه الحالة نهائية بالفعل؛ أعد فتح البلاغ إذا لزم تعديل القرار.');
    const note = typeof input.resolutionNote === 'string' ? input.resolutionNote.trim().slice(0,1000) : '';
    const codes = new Set(['fixed','clarified','invalid','duplicate','other']);
    let code = typeof input.resolutionCode === 'string' ? input.resolutionCode : '';
    if (code && !codes.has(code)) fail('تصنيف قرار المعالجة غير صالح.');
    if (['needs_revision','resolved','rejected'].includes(nextStatus) && !note) {
      fail(nextStatus === 'needs_revision' ? 'اكتب ما يحتاج إلى تصحيح حتى يعرف المنفذ المطلوب.' : nextStatus === 'rejected' ? 'اكتب سبب استبعاد البلاغ.' : 'اكتب ملخص التصحيح أو الحل قبل إغلاق البلاغ.');
    }
    let duplicateOf = null;
    if (nextStatus === 'duplicate') {
      const duplicateId = cleanString(input.duplicateOf, 'معرّف البلاغ الأصلي', 100);
      if (duplicateId === id) fail('لا يمكن ربط البلاغ بنفسه.');
      const primary = await db.select().from(questionReports).where(eq(questionReports.id, duplicateId)).get();
      if (!primary) fail('البلاغ الأصلي غير موجود.');
      requireCourseScope(auth, primary.courseId);
      if (String(primary.questionId) !== String(found.questionId)) fail('يمكن ربط البلاغ المكرر ببلاغ آخر عن السؤال نفسه فقط.');
      if (primary.status === 'duplicate') fail('اختر البلاغ الأصلي، لا بلاغًا مرتبطًا ببلاغ آخر كمكرر.');
      duplicateOf = duplicateId;
      code = 'duplicate';
    } else if (nextStatus === 'resolved') {
      if (!code) code = 'fixed';
      if (!['fixed','clarified','other'].includes(code)) fail('اختر قرارًا مناسبًا للإغلاق بعد المعالجة.');
    } else if (nextStatus === 'rejected') {
      if (!code) code = 'invalid';
      if (!['invalid','other'].includes(code)) fail('تصنيف قرار الاستبعاد غير مناسب.');
    } else if (nextStatus === 'needs_revision') {
      code = 'fixed';
    } else if (nextStatus === 'open' || nextStatus === 'in_review') {
      code = '';
      duplicateOf = null;
    }
    const now = Date.now();
    const reopened = nextStatus === 'open';
    const closed = terminal.includes(nextStatus);
    let assignedTo = found.assignedTo ?? null;
    let assignedName = found.assignedName || '';
    if (reopened) { assignedTo = null; assignedName = ''; }
    else if (!closed && !assignedTo) { assignedTo = auth.telegramId; assignedName = auth.actorName; }
    const resolutionNote = reopened ? (note || '') : (note || found.resolutionNote || (nextStatus === 'in_review' ? 'بدأت مراجعة البلاغ.' : ''));
    const updates = {
      status:nextStatus, assignedTo, assignedName, resolutionNote, resolutionCode:code,
      duplicateOf, updatedAt:now, lastActionBy:auth.telegramId,
      resolvedAt:closed ? now : null, resolvedBy:closed ? auth.telegramId : null,
    };
    await db.update(questionReports).set(updates).where(eq(questionReports.id,id)).run();
    await audit(auth, 'question_report_status_changed', 'question_report', 0, {
      reportId:id, questionId:found.questionId, from:found.status, to:nextStatus,
      resolutionCode:code, resolutionNote, duplicateOf,
    });
    return {ok:true, report:{...found,...updates}};
  }
  // Backward compatibility for clients that still use the old one-button flow.
  if (action === 'resolveQuestionReport') {
    requirePermission(auth, 'questions.write');
    const id = cleanString(input.id, 'معرّف البلاغ', 100);
    const found = await db.select().from(questionReports).where(eq(questionReports.id, id)).get();
    if (!found) fail('البلاغ غير موجود.');
    requireCourseScope(auth, found.courseId);
    const resolved = input.resolved === true;
    const now = Date.now();
    const status = resolved ? 'resolved' : 'open';
    const updates = {status, resolutionNote:resolved?'تمت المعالجة عبر الإجراء القديم.':'أعيد فتح البلاغ.',resolutionCode:resolved?'other':'',duplicateOf:null,updatedAt:now,lastActionBy:auth.telegramId,resolvedAt:resolved?now:null,resolvedBy:resolved?auth.telegramId:null,assignedTo:resolved?(found.assignedTo??auth.telegramId):null,assignedName:resolved?(found.assignedName||auth.actorName):''};
    await db.update(questionReports).set(updates).where(eq(questionReports.id,id)).run();
    await audit(auth, resolved ? 'question_report_resolved' : 'question_report_reopened', 'question_report', 0, {reportId:id, questionId:found.questionId, compatibilityAction:true});
    return {ok:true, report:{...found,...updates}};
  }
  if (action === 'dashboard') return rowsForDashboard(auth);
  if (action === 'visitorList') return visitorAnalyticsForOwner(auth);
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
  if (action === 'recordBackupExport') return recordBackupExport(auth, input);

  if (action === 'saveLevel') return saveLevel(auth, input);
  if (action === 'setLevelActive') return setLevelActive(auth, input);
  if (action === 'saveSubject') return saveSubject(auth, input);
  if (action === 'setSubjectActive') return setSubjectActive(auth, input);
  if (action === 'saveCourse') return saveCourse(auth, input);
  if (action === 'moveCourseWithinLevel') return moveCourseWithinLevel(auth, input);
  if (action === 'setCourseActive') return setCourseActive(auth, input);
  if (action === 'saveQuestion') return saveQuestion(auth, input);
  if (action === 'importModelJson') return importModelJson(auth, input);
  if (action === 'setQuestionActive') return setQuestionActive(auth, input);
  if (action === 'updateModel') return updateModel(auth, input);
  if (action === 'moveModelWithinLevel') return moveModelWithinLevel(auth, input);
  if (action === 'deleteModel') return deleteModel(auth, input);
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
