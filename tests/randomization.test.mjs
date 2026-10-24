import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const miniApp = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');

test('خلط الأسئلة ينتج تبديلات من نفس المجموعة ولا يحذف أي سؤال', () => {
  const match = miniApp.match(/function shuffle\(a\) \{[\s\S]*?\n\}/);
  assert.ok(match, 'دالة خلط الأسئلة موجودة');
  const shuffle = vm.runInNewContext('(' + match[0] + ')');
  const questions = Array.from({ length: 12 }, (_, i) => ({ question_id: i + 1 }));
  const originalIds = questions.map((q) => q.question_id).sort((a, b) => a - b);
  const orders = new Set();

  for (let i = 0; i < 20; i++) {
    const result = shuffle([...questions]);
    assert.deepEqual(
      Array.from(result, (q) => q.question_id).sort((a, b) => a - b),
      originalIds,
      'يجب أن تبقى كل الأسئلة دون تكرار أو فقدان',
    );
    orders.add(result.map((q) => q.question_id).join(','));
  }

  assert.ok(orders.size > 1, 'يجب أن تنتج المحاولات ترتيبات مختلفة');
});

test('بدء محاولة جديدة لا يستعيد ترتيب محاولة قديمة غير مكتملة', () => {
  const startIndex = miniApp.indexOf('async function start()');
  const endIndex = miniApp.indexOf('\nfunction updateTimer()', startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex, 'دالة بدء الاختبار موجودة');
  const startBody = miniApp.slice(startIndex, endIndex);

  assert.match(startBody, /session = shuffle\(\[\.\.\.pool\]\)/);
  assert.doesNotMatch(startBody, /session\s*=\s*resume\.session/);
  assert.match(startBody, /studentApi\("abandonAttempt",\s*\{\s*attemptId:\s*attempt\.id\s*\}\)/);
  assert.match(startBody, /questionIds:\s*session\.map\(\(q\)\s*=>\s*q\.question_id\)/);
});
