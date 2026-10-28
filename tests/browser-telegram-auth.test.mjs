import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const miniApp = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const studentApi = fs.readFileSync(new URL('../tgcloud/endpoints/studentApi.js', import.meta.url), 'utf8');

test('browser visitors must use the fixed account username and password before seeing the test bank', () => {
  assert.match(miniApp, /id="start" class="panel start-panel hidden"/);
  assert.match(miniApp, /id="loginIdentifier"/);
  assert.match(miniApp, /id="loginPassword" type="password"/);
  assert.match(miniApp, /اسم المستخدم الثابت الذي يُنشأ لك تلقائيًا/);
  assert.match(miniApp, /No anonymous browser session/);
  assert.match(miniApp, /\$\("authPanel"\)\.classList\.remove\("hidden"\)/);
  assert.match(miniApp, /\$\("start"\)\.classList\.add\("hidden"\)/);
  assert.match(miniApp, /loadSignupLevels\(\)/);
});

test('Telegram launch bypasses browser login and links identity through server-verified Telegram data', () => {
  assert.match(miniApp, /const telegramLaunch = Boolean\(/);
  assert.match(miniApp, /if \(telegramLaunch\) \{[\s\S]*?studentSession = null;[\s\S]*?studentApi\("me"\)\.then\(data => \{[\s\S]*?studentCloudData = data;[\s\S]*?return loadCatalogFromSupabase\(\)/);
  assert.match(miniApp, /if \(telegramLaunch\) \{[\s\S]*?\$\("authPanel"\)\.classList\.add\("hidden"\)/);
  assert.match(studentApi, /const user = ctx\?\.initData\?\.user/);
  assert.match(studentApi, /return await supabaseStudentRequest\(action, input\.payload \|\| \{\}, auth\)/);
});
