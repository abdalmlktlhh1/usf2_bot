import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// A single syntax error inside an inline <script> stops the whole page from running.
// This once left the admin dashboard on a permanent loading screen, so every
// front-end page is parsed here before it can be deployed.
const pages = ['app/admin.html', 'app/index.html'];

for (const page of pages) {
  test(`السكربتات المضمنة في ${page} سليمة الصياغة`, () => {
    const html = fs.readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    assert.ok(scripts.length > 0, 'لا يوجد سكربت مضمن في الصفحة');
    scripts.forEach((code, index) => {
      assert.doesNotThrow(
        () => new vm.Script(code, { filename: `${page}#script${index}` }),
        `خطأ صياغة في سكربت ${page} رقم ${index}`,
      );
    });
  });
}
