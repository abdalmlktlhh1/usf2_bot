import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('جداول TGCloud تشمل الزوار الموثقين وإعلانات الإنجازات وبلاغات الأسئلة وطلبات المراجعة', () => {
  const schema = read('tgcloud/schema.js');
  for (const table of ['visitorStats', 'achievementEvents', 'questionReports', 'questionApprovalRequests', 'botMenuItems', 'siteSettings']) {
    assert.match(schema, new RegExp('export const ' + table + '\\s*='), 'missing TGCloud schema table: ' + table);
  }
  assert.match(schema, /telegram_id/);
  assert.match(schema, /uq_achievement_events_user_key/);
  assert.match(schema, /idx_question_reports_status/);
});

test('واجهة الإدارة تحتفظ بالبلاغات وطلبات المراجعة والتحليلات مع إدارة الطلاب', () => {
  const api = read('tgcloud/endpoints/adminApi.js');
  for (const action of [
    'questionReports', 'claimQuestionReport', 'updateQuestionReport', 'resolveQuestionReport',
    'questionApprovalRequests', 'submitQuestionForApproval', 'approveQuestionRequest', 'rejectQuestionRequest',
    'visitorList', 'moveCourseWithinLevel', 'moveModelWithinLevel', 'listStudents', 'setStudentStatus',
  ]) {
    assert.ok(api.includes(action), 'missing admin API capability: ' + action);
  }
  assert.match(api, /students\.read/);
  assert.match(api, /if \(!auth\.isOwner\) fail\('إيقاف حسابات الطلاب متاح للمدير الرئيسي فقط\.'/);
});

test('إعلانات الإنجازات وبلاغات الأسئلة لا تقبل هوية يرسلها المتصفح بدل Telegram الموثق', () => {
  const achievements = read('tgcloud/endpoints/achievementEvents.js');
  const reports = read('tgcloud/endpoints/questionReports.js');
  const visitors = read('tgcloud/endpoints/visitorStats.js');
  for (const source of [achievements, reports, visitors]) {
    assert.match(source, /ctx\?\.initData\?\.user/);
  }
  assert.match(achievements, /action === 'feed'/);
  assert.match(reports, /questionReports\)\.values\(report\)/);
  assert.doesNotMatch(visitors, /input\.visitorId/);
});

test('المسار القديم لإدارة الطلاب يحوّل إلى اللوحة الحالية ولا يعرض موافقات التسجيل', () => {
  const legacyRoute = read('app/admin-students.html');
  assert.match(legacyRoute, /location\.replace\('admin\.html\?v=20261030-ehsan-presence2'\)/);
  assert.doesNotMatch(legacyRoute, /طلبات التسجيل المنتظرة|اعتماد حساب المتقدمين|api\("pending"\)/);
});

test('لوحة الإدارة تستخدم علامة إحسان بدل اسم البوت القديم', () => {
  const admin = read('app/admin.html');
  assert.match(admin, /<title>لوحة الإدارة \| إحسان<\/title>/);
  assert.match(admin, /لوحة إدارة إحسان/);
  assert.doesNotMatch(admin, /لوحة إدارة بوت الاختبارات/);
});
