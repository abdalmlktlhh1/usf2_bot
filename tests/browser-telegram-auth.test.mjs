import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const miniApp = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const studentApi = fs.readFileSync(new URL('../tgcloud/endpoints/studentApi.js', import.meta.url), 'utf8');
const studentAuth = fs.readFileSync(new URL('../supabase/functions/student-auth/index.ts', import.meta.url), 'utf8');
const browserStudentData = fs.readFileSync(new URL('../supabase/functions/browser-student-data/index.ts', import.meta.url), 'utf8');

test('المتصفح يحتفظ بدخول الحسابات السابقة ولا يتيح إنشاء حساب بالموافقة اليدوية', () => {
  assert.match(miniApp, /id="start" class="panel start-panel hidden"/);
  assert.match(miniApp, /id="loginIdentifier"/);
  assert.match(miniApp, /id="loginPassword" type="password"/);
  assert.match(miniApp, /إنشاء الحسابات الجديدة يتم عبر فتح المنصة من داخل تيليجرام/);
  assert.doesNotMatch(miniApp, /signupForm|signupTab|loadSignupLevels|signupPassword/);
  assert.match(miniApp, /\$\("authPanel"\)\.classList\.remove\("hidden"\)/);
  assert.match(miniApp, /\$\("start"\)\.classList\.add\("hidden"\)/);
});

test('Telegram auth uses server-verified identity, assigns a level only on first visit, and creates a session', () => {
  assert.match(miniApp, /const telegramLaunch = Boolean\(/);
  assert.match(miniApp, /if \(telegramLaunch\)/);
  assert.match(miniApp, /waitForTelegramServerless\(\)/);
  assert.match(miniApp, /studentApi\("appAuth",levelId\?\{levelId\}:\{\}\)/);
  assert.match(miniApp, /if\(result\?\.needsLevel\)[\s\S]*?showTelegramLevelSetup\(result\)/);
  assert.match(miniApp, /saveTelegramAuthSession\(result\)/);
  assert.match(miniApp, /id="telegramLevel"/);
  assert.match(miniApp, /await runTelegramAccountAuth\(\)/);
  assert.match(studentApi, /const user = ctx\?\.initData\?\.user/);
  assert.match(studentApi, /'appAuth'/);
  assert.match(studentApi, /return await supabaseStudentRequest\(action, input\.payload \|\| \{\}, auth\)/);
});

test('Telegram identity details are taken from verified initData and include the profile photo', () => {
  assert.match(studentApi, /photo_url: typeof user\.photo_url === 'string' \? user\.photo_url : ''/);
  assert.match(studentApi, /const telegramId = Number\(user\?\.id\)/);
});


test('مسارا Telegram والمتصفح يستخدمان الحساب نفسه ومخزن النتائج نفسه', () => {
  assert.match(miniApp, /BROWSER_STUDENT_DATA_URL/);
  assert.match(miniApp, /Authorization: "Bearer " \+ token/);
  assert.match(miniApp, /telegramServerlessCall\("studentApi", \{[\s\S]*?accessToken: studentSession\?\.accessToken/);
  assert.match(studentApi, /SHARED_ACCOUNT_ACTIONS/);
  assert.match(studentApi, /body: JSON\.stringify\(\{ action, payload: input\.payload \|\| \{\}, telegramId \}\)/);
  assert.match(browserStudentData, /legacyTelegramAccount/);
  assert.match(browserStudentData, /attemptsTable = legacyTelegramAccount \? "student_attempts" : "app_student_attempts"/);
  assert.match(browserStudentData, /progressTable = legacyTelegramAccount \? "student_progress" : "app_student_progress"/);
  assert.match(browserStudentData, /requestedTelegramId/);
});


test('تهيئة Telegram لا تنتظر قراءة سجل غير أساسي قبل إظهار القائمة والمستويات', () => {
  assert.match(miniApp, /function telegramServerlessCall\(moduleName, payload = \{\}, timeoutMs = 20000\)/);
  assert.match(miniApp, /setTimeout\(\(\) => \{[\s\S]*?تأخر رد الخادم/);
  assert.match(miniApp, /if \(studentSession\?\.telegramAuth !== true\) await refreshStudentProfile\(\)/);
  assert.match(miniApp, /\$\("menuBtn"\)\.classList\.remove\("hidden"\)/);
  assert.match(miniApp, /\$\("start"\)\.classList\.remove\("hidden"\)/);
  assert.match(miniApp, /studentApi\("me"\)\.then\(\(data\) => \{ studentCloudData=data; \}\)/);
  assert.match(miniApp, /retry\.textContent="إعادة تحميل المستويات"/);
});

test('كلمة مرور المتصفح اختيارية وتُضبط من الحساب، وشرط الموافقة الإدارية ملغى', () => {
  assert.match(miniApp, /setPassword/);
  assert.match(studentAuth, /if\(action==="setPassword"\)/);
  assert.match(studentAuth, /admin\.auth\.admin\.updateUserById\(user\.id,\{password\}\)/);
  assert.doesNotMatch(studentAuth, /حسابك بانتظار موافقة المشرف/);
  assert.doesNotMatch(studentAuth, /حسابك غير معتمد حاليًا/);
  assert.match(studentAuth, /\["suspended","blocked"\]/);
});


test('تجديد الجلسة مرة واحدة عند انتهاء رمز الفهرس قبل إظهار فشل تحميل المستويات', () => {
  assert.match(miniApp, /async function fetchCatalogWithSession\(url, cacheMode = ""\)/);
  assert.match(miniApp, /response\.status === 401 && studentSession\?\.refreshToken && await refreshBrowserSession\(\)/);
  assert.match(miniApp, /fetchCatalogWithSession\(SUPABASE_URL \+ "\/functions\/v1\/public-catalog"\)/);
  assert.match(miniApp, /fetchCatalogWithSession\(url, "no-store"\)/);
});


test('واجهة المستويات لا تنتظر حفظ الفهرس الكبير في IndexedDB', () => {
  const loader = miniApp.slice(miniApp.indexOf('async function loadCatalogFromSupabase'), miniApp.indexOf('async function fetchCatalogWithSession'));
  assert.match(loader, /applyCatalogResult\(result\);[\s\S]*?void writeCatalogCache\(/);
  assert.doesNotMatch(loader, /await writeCatalogCache\(\{ payload: result/);
  assert.match(miniApp, /const CATALOG_CACHE_KEY = "public_catalog_v3"/);
  assert.match(miniApp, /\$\("menuBtn"\)\.classList\.remove\("hidden"\)/);
  assert.match(miniApp, /\$\("start"\)\.classList\.remove\("hidden"\)/);
});

test('فشل تهيئة Telegram يعرض زر إعادة محاولة بدلاً من ترك الواجهة مخفية', () => {
  assert.match(miniApp, /function showTelegramStartupError\(error\)/);
  assert.match(miniApp, /id = "telegramRetryBtn"/);
  assert.match(miniApp, /waitForTelegramServerless\(150\)/);
  assert.match(miniApp, /runTelegramAccountAuth\(\)/);
  assert.match(miniApp, /\.catch\(\(error\) => showTelegramStartupError\(error\)\)/);
});
