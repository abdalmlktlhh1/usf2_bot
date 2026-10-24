import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('الفهرس يأتي من Supabase ولا يحتفظ بنسخة محتوى قديمة داخل الصفحة', () => {
  const miniApp = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(miniApp, /let CATALOG = \{ levels: \[\] \}/);
  assert.match(miniApp, /functions\/v1\/public-catalog/);
  assert.doesNotMatch(miniApp, /SUPABASE_ANON_JWT|SUPABASE_PUBLIC_KEY/);
  assert.match(miniApp, /if \(studentSession\) \{[\s\S]*?activateStudent\(\)/);
  assert.match(miniApp, /ensureSiteAvailable\(\)\.then\(available => \{[\s\S]*?loadCatalogFromSupabase\(\)/);
  assert.match(miniApp, /catalogLoadState = 'error'/);
  assert.doesNotMatch(miniApp, /سجّل الدخول لعرض المحتوى|سجل الدخول لعرض المحتوى/);
  assert.doesNotMatch(miniApp, /try \{ studentSession = JSON\.parse\(sessionStorage\.getItem\(AUTH_SESSION_KEY\)[\s\S]{0,200}loadCatalogFromSupabase\(\)\.then/);
});

test('تقدم الطالب محفوظ على الخادم ومربوط بهوية Telegram الموثقة', () => {
  const studentApi = fs.readFileSync(new URL('../tgcloud/endpoints/studentApi.js', import.meta.url), 'utf8');
  const studentHelper = fs.readFileSync(new URL('../tgcloud/lib/supabase-students.js', import.meta.url), 'utf8');
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
  assert.match(miniApp, /window\.location\.href = "admin\.html\?v=20261024b"/);
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
