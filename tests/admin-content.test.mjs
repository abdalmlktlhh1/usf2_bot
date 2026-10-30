import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('الفهرس يأتي من Supabase ولا يحتفظ بنسخة محتوى قديمة داخل الصفحة', () => {
  const miniApp = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(miniApp, /let CATALOG = \{ levels: \[\] \}/);
  assert.match(miniApp, /functions\/v1\/public-catalog/);
  assert.doesNotMatch(miniApp, /SUPABASE_ANON_JWT|SUPABASE_PUBLIC_KEY/);
  assert.match(miniApp, /if \(studentSession\) \{[\s\S]*?activateStudent\(\)/);
  assert.match(miniApp, /function activateStudent\(\)[\s\S]*?loadCatalogFromSupabase\(\)/);
  assert.match(miniApp, /if \(telegramLaunch\)[\s\S]*?waitForTelegramServerless\(\)[\s\S]*?runTelegramAccountAuth\(\)/);
  assert.match(miniApp, /catalogLoadState = 'error'/);
  assert.doesNotMatch(miniApp, /سجّل الدخول لعرض المحتوى|سجل الدخول لعرض المحتوى/);
  assert.doesNotMatch(miniApp, /try \{ studentSession = JSON\.parse\(sessionStorage\.getItem\(AUTH_SESSION_KEY\)[\s\S]{0,200}loadCatalogFromSupabase\(\)\.then/);
});

test('تقدم الطالب محفوظ على الخادم ومربوط بهوية Telegram الموثقة', () => {
  const studentApi = fs.readFileSync(new URL('../tgcloud/endpoints/studentApi.js', import.meta.url), 'utf8');
  const studentHelper = fs.readFileSync(new URL('../tgcloud/lib/supabase-students.js.example', import.meta.url), 'utf8');
  const miniApp = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(studentApi, /ctx\?\.initData\?\.user/);
  assert.match(studentApi, /startAttempt.*saveProgress.*completeAttempt/s);
  assert.match(studentHelper, /functions\/v1\/student-data/);
  assert.match(miniApp, /drawerAccountBtn/);
  assert.match(miniApp, /queueStudentProgressSave/);
  assert.match(miniApp, /completeStudentAttempt/);
});

test('واجهة الإدارة تتحقق من الحساب عبر API ولا تعتمد على إظهار الزر فقط', () => {
  const adminApi = fs.readFileSync(new URL('../tgcloud/endpoints/adminApi.js', import.meta.url), 'utf8');
  const miniApp = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const adminPage = fs.readFileSync(new URL('../app/admin.html', import.meta.url), 'utf8');
  assert.match(adminApi, /const OWNER_ID = 5187563344/);
  assert.match(adminApi, /ctx\?\.initData\?\.user/);
  assert.match(adminApi, /إدارة المشرفين مخصصة للمدير الرئيسي فقط/);
  assert.match(adminApi, /لا يمكن تغيير صلاحيات المدير الرئيسي أو استبداله/);
  assert.match(adminPage, /Telegram\.WebApp/);
  assert.match(miniApp, /id="drawerAdminBtn"/);
  assert.match(miniApp, /window\.location\.href = "admin\.html\?v=20261030-ehsan-ui-final2"/);
});

test('واجهة الإدارة تتضمن إدارة المستوى والمادة والمقرر والأسئلة والمشرفين والسجل', () => {
  const adminHtml = fs.readFileSync(new URL('../app/admin.html', import.meta.url), 'utf8');
  const adminApi = fs.readFileSync(new URL('../tgcloud/endpoints/adminApi.js', import.meta.url), 'utf8');
  for (const action of ['saveLevel', 'saveSubject', 'saveCourse', 'saveQuestion', 'saveModerator', 'setModeratorActive']) {
    assert.ok(adminHtml.includes(action) || adminApi.includes(action));
  }
  for (const label of ['المستويات', 'المواد', 'المقررات', 'الأسئلة', 'المشرفون', 'سجل العمليات']) {
    assert.ok(adminHtml.includes(label));
  }
});


test('لوحة أزرار البوت تدعم القوائم المتداخلة والترتيب والحذف بصلاحية المالك فقط', () => {
  const adminApi = fs.readFileSync(new URL('../tgcloud/endpoints/adminApi.js', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../tgcloud/schema.js', import.meta.url), 'utf8');
  const menuLib = fs.readFileSync(new URL('../tgcloud/lib/bot-menu.js', import.meta.url), 'utf8');
  const messageHandler = fs.readFileSync(new URL('../tgcloud/handlers/message.js', import.meta.url), 'utf8');
  const callbackHandler = fs.readFileSync(new URL('../tgcloud/handlers/callback_query.js', import.meta.url), 'utf8');
  const adminHtml = fs.readFileSync(new URL('../app/admin.html', import.meta.url), 'utf8');

  assert.match(schema, /bot_menu_items/);
  for (const action of ['listBotMenuItems', 'saveBotMenuItem', 'deleteBotMenuItem', 'moveBotMenuItem', 'toggleBotMenuItem']) {
    assert.ok(adminApi.includes(action), 'missing menu API action: ' + action);
  }
  assert.match(adminApi, /إدارة أزرار البوت مخصصة للمدير الرئيسي فقط/);
  assert.match(menuLib, /parentId/);
  assert.match(menuLib, /getBotMenuKeyboard/);
  assert.match(menuLib, /protocol === 'https:'/);
  assert.match(messageHandler, /getBotMenuKeyboard/);
  assert.match(callbackHandler, /menu:open/);
  assert.match(callbackHandler, /isBotMenuItemVisible/);
  for (const label of ['أزرار البوت', 'إضافة زر', 'addBotChild', 'editBotMenu', 'moveBotMenuItem', 'deleteBotMenu']) {
    assert.ok(adminHtml.includes(label), 'missing menu editor UI: ' + label);
  }
});


test('التصفح الدراسي هرمي وروابط أزرار المستوى والمادة والمقرر والنموذج تُعالج مباشرة', () => {
  const miniApp = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const callbackHandler = fs.readFileSync(new URL('../tgcloud/handlers/callback_query.js', import.meta.url), 'utf8');
  const menuLib = fs.readFileSync(new URL('../tgcloud/lib/bot-menu.js', import.meta.url), 'utf8');
  assert.match(miniApp, /level\.subjects\.push\(subject\)/);
  assert.match(miniApp, /function renderSubjects\(\)/);
  assert.match(miniApp, /function chooseSubject\(subject\)/);
  assert.match(miniApp, /target === "model"/);
  assert.match(miniApp, /sourceYear/);
  assert.match(miniApp, /catalog-enter/);
  assert.match(miniApp, /availableModels/);
  assert.match(menuLib, /params\.set\('target', target\.targetType\)/);
  assert.match(callbackHandler, /menu:open:/);
  const openLine = callbackHandler.split('\n').find((line) => line.includes('const openMenuMatch ='));
  assert.ok(openLine && /^  const openMenuMatch = \/\^menu:open:/.test(openLine));
  const matcher = /^menu:open:(\d+)$/;
  assert.equal(matcher.exec('menu:open:12')?.[1], '12');
});


test('إدارة الطلاب متاحة للمدير وتدعم الإيقاف دون حذف سجل الطالب', () => {
  const adminHtml = fs.readFileSync(new URL('../app/admin.html', import.meta.url), 'utf8');
  const adminApi = fs.readFileSync(new URL('../tgcloud/endpoints/adminApi.js', import.meta.url), 'utf8');
  const contentAdmin = fs.readFileSync(new URL('../supabase/functions/content-admin/index.ts', import.meta.url), 'utf8');
  assert.match(adminHtml, /data-page="students"/);
  assert.match(adminHtml, /function renderStudents/);
  assert.match(adminHtml, /toggleStudent/);
  assert.match(adminApi, /students\.read/);
  assert.match(adminApi, /action === 'listStudents'/);
  assert.match(adminApi, /action === 'setStudentStatus'/);
  assert.match(contentAdmin, /async function listStudents/);
  assert.match(contentAdmin, /async function setStudentStatus/);
  assert.match(contentAdmin, /auth\.isOwner/);
  assert.match(contentAdmin, /\["approved","suspended"\]/);
  assert.doesNotMatch(contentAdmin, /deleteUser|delete\(\).*app_student_profiles/);
});


test('تسجيل دخول المدير من المتصفح يتحقق من دور admin في الخادم ولا يثق بصلاحيات العميل', () => {
  const app = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const adminPage = fs.readFileSync(new URL('../app/admin.html', import.meta.url), 'utf8');
  const contentAdmin = fs.readFileSync(new URL('../supabase/functions/content-admin/index.ts', import.meta.url), 'utf8');
  assert.match(app, /studentSession\?\.profile\?\.role === "admin"/);
  assert.match(adminPage, /BROWSER_ADMIN_API_URL/);
  assert.match(adminPage, /sessionStorage\.getItem\("usf2_student_session_v1"\)/);
  assert.match(adminPage, /Authorization: "Bearer " \+ session\.accessToken/);
  assert.match(contentAdmin, /supabase\.auth\.getUser\(token\)/);
  assert.match(contentAdmin, /profile\.role!=="admin"/);
  assert.match(contentAdmin, /result\.browserAdmin=true/);
  assert.doesNotMatch(contentAdmin, /auth=body\.auth\|\|\{\}/);
});
