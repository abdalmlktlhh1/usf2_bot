import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTIONS,
  homeText,
  homeKeyboard,
  helpText,
  helpKeyboard,
  questionText,
  questionKeyboard,
  resultText,
  resultKeyboard,
} from '../tgcloud/lib/quiz.js';

test('كل الأسئلة لها إجابة صحيحة وخيارات صالحة', () => {
  assert.equal(QUESTIONS.length, 5);
  for (const question of QUESTIONS) {
    assert.ok(question.text.length > 0);
    assert.ok(question.options.length >= 2);
    assert.ok(Number.isInteger(question.correct));
    assert.ok(question.correct >= 0 && question.correct < question.options.length);
    assert.ok(question.explanation.length > 0);
  }
});

test('لوحة كل سؤال تحتوي خيارًا واحدًا لكل إجابة ضمن حد callback_data', () => {
  QUESTIONS.forEach((question, index) => {
    const keyboard = questionKeyboard(index);
    const buttons = keyboard.inline_keyboard.flat();
    assert.equal(buttons.length, question.options.length);
    for (const button of buttons) {
      assert.match(button.callback_data, /^quiz:answer:\d+:\d+$/);
      assert.ok(Buffer.byteLength(button.callback_data, 'utf8') <= 64);
    }
  });
});

test('السؤال ورقم التقدم والنتيجة يتم عرضها بشكل متسق', () => {
  assert.match(questionText(0), /السؤال 1 من 5/);
  assert.match(questionText(4), /السؤال 5 من 5/);
  assert.equal(questionText(5), '');
  assert.equal(questionKeyboard(5).inline_keyboard.length, 0);
  assert.match(resultText(5), /5 من 5/);
  assert.match(resultText(0), /0 من 5/);
  assert.ok(resultKeyboard().inline_keyboard.length > 0);
});

test('القائمة والتعليمات تفتح المنصة التفاعلية ولا تعرض أوامر الاختبار النصي القديم', () => {
  assert.match(homeText(), /بوت الاختبارات/);
  assert.match(helpText(), /الاختبار التفاعلي/);
  assert.doesNotMatch(helpText(), /\/quiz|\/test/);
  for (const keyboard of [homeKeyboard(), helpKeyboard()]) {
    const buttons = keyboard.inline_keyboard.flat();
    const appButton = buttons.find((button) => button.web_app && button.web_app.url === 'https://app8964547541.tgcloud.ai/?v=20261030-ehsan-ui-final2');
    assert.ok(appButton, 'يجب توفير زر لفتح المنصة التفاعلية');
    for (const button of buttons.filter((item) => item.callback_data)) {
      assert.equal(button.callback_data, 'menu:home');
    }
  }
  assert.equal(homeKeyboard().inline_keyboard.flat().some((button) => button.callback_data), false);
});

test('واجهة الاختبار تدعم اختصارات لوحة المفاتيح وتصف بيانات المنصة بدقة', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(html, /PageDown/);
  assert.match(html, /PageUp/);
  assert.match(html, /querySelectorAll\("button\.choice:not\(:disabled\)"\)/);
  assert.match(html, /منصة الاختبارات التفاعلية للجنة العلمية/);
  assert.doesNotMatch(html, /نتائج محفوظة محليًا على جهازك/);
});
