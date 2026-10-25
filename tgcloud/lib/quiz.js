export const QUESTIONS = [
  {
    text: 'كم يساوي 7 + 5؟',
    options: ['10', '11', '12', '13'],
    correct: 2,
    explanation: '7 + 5 = 12.',
  },
  {
    text: 'ما أكبر كواكب المجموعة الشمسية؟',
    options: ['الأرض', 'المريخ', 'المشتري', 'الزهرة'],
    correct: 2,
    explanation: 'المشتري هو أكبر كواكب المجموعة الشمسية.',
  },
  {
    text: 'ما الصيغة الكيميائية للماء؟',
    options: ['CO₂', 'H₂O', 'O₂', 'NaCl'],
    correct: 1,
    explanation: 'يتكوّن جزيء الماء من ذرتي هيدروجين وذرة أكسجين.',
  },
  {
    text: 'كم ضلعًا للمثلث؟',
    options: ['ضلعان', 'ثلاثة أضلاع', 'أربعة أضلاع', 'خمسة أضلاع'],
    correct: 1,
    explanation: 'للمثلث ثلاثة أضلاع وثلاث زوايا.',
  },
  {
    text: 'ما وحدة قياس شدة التيار الكهربائي في النظام الدولي؟',
    options: ['الفولت', 'الواط', 'الأمبير', 'الأوم'],
    correct: 2,
    explanation: 'الأمبير هو وحدة قياس شدة التيار الكهربائي.',
  },
];

export function homeText() {
  return `أهلًا بك في بوت الاختبارات! 🎓

افتح «الاختبار التفاعلي» لبدء اختبار محاسبة المراجعة (أ) المكوّن من ٤٩ سؤالًا، مع ترتيب عشوائي ومؤقت ونتيجة نهائية ومراجعة للإجابات.

ويمكنك اختيار «ابدأ اختبارًا نصيًا» لخوض الاختبار التجريبي داخل المحادثة.`;
}

export function helpText() {
  return `📚 المساعدة — بوت الاختبارات

/start — بدء البوت
/quiz — بدء اختبار نصي جديد
/help — عرض التعليمات
/about — معلومات عن البوت
/cancel — إلغاء الاختبار النصي الحالي
/id — عرض معرّف المحادثة ومعرّف حسابك

اختر «فتح الاختبار التفاعلي» لفتح صفحة محاسبة المراجعة (أ)، أو «ابدأ اختبارًا نصيًا» للاختبار التجريبي داخل المحادثة.`;
}

const MINI_APP_URL = 'https://app8964547541.tgcloud.ai/';

export function homeKeyboard(isAdmin = false) {
  const rows = [
    [{ text: '📱 الاختبار التفاعلي', web_app: { url: MINI_APP_URL } }],
  ];
  if (isAdmin) rows.push([{ text: '⚙️ لوحة الإدارة', web_app: { url: `${MINI_APP_URL}admin.html?v=20261025a` } }]);
  rows.push(
    [{ text: '📝 ابدأ اختبارًا نصيًا', callback_data: 'quiz:start' }],
    [{ text: '❔ طريقة الاستخدام', callback_data: 'menu:help' }],
  );
  return { inline_keyboard: rows };
}

export function helpKeyboard(isAdmin = false) {
  const rows = [
    [{ text: '📱 فتح الاختبار التفاعلي', web_app: { url: MINI_APP_URL } }],
  ];
  if (isAdmin) rows.push([{ text: '⚙️ لوحة الإدارة', web_app: { url: `${MINI_APP_URL}admin.html?v=20261025a` } }]);
  rows.push(
    [{ text: '📝 ابدأ اختبارًا نصيًا', callback_data: 'quiz:start' }],
    [{ text: '🏠 القائمة الرئيسية', callback_data: 'menu:home' }],
  );
  return { inline_keyboard: rows };
}

export function questionText(index) {
  const question = QUESTIONS[index];
  if (!question) return '';
  return `السؤال ${index + 1} من ${QUESTIONS.length}\n\n${question.text}`;
}

export function questionKeyboard(index) {
  const question = QUESTIONS[index];
  if (!question) return { inline_keyboard: [] };

  const rows = [];
  for (let i = 0; i < question.options.length; i += 2) {
    rows.push(
      question.options.slice(i, i + 2).map((label, offset) => ({
        text: label,
        callback_data: `quiz:answer:${index}:${i + offset}`,
      })),
    );
  }
  return { inline_keyboard: rows };
}

export function resultText(score) {
  let feedback = 'يمكنك إعادة الاختبار لتحسين نتيجتك.';
  if (score === QUESTIONS.length) feedback = 'ممتاز! أجبت عن جميع الأسئلة إجابة صحيحة. 🏆';
  else if (score >= QUESTIONS.length - 1) feedback = 'أداء رائع! 🌟';
  else if (score >= Math.ceil(QUESTIONS.length / 2)) feedback = 'أداء جيد، واصل التعلّم. 👍';

  return `انتهى الاختبار! 🎉\n\nنتيجتك: ${score} من ${QUESTIONS.length}\n${feedback}`;
}

export function resultKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔁 أعد الاختبار', callback_data: 'quiz:start' }],
      [{ text: '🏠 القائمة الرئيسية', callback_data: 'menu:home' }],
    ],
  };
}
