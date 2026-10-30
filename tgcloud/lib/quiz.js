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
  return `أهلًا بك في بوت الاختبارات ⚖️📚

🏫 كلية الشريعة والقانون — جامعة صنعاء

افتح «الاختبار التفاعلي» لاستعراض المستويات الدراسية، ثم اختر المقرر والنموذج المتاح لبدء الاختبار. بعد الإنهاء ستظهر نتيجتك مع إمكانية مراجعة الإجابات.

تُعرض النماذج بحسب المحتوى المضاف للمنصة. اختر زر «الاختبار التفاعلي» لاستعراض المقررات والنماذج المتاحة.`;
}

export function helpText() {
  return `📚 بوت الاختبارات

🏫 كلية الشريعة والقانون — جامعة صنعاء

لاستعراض الاختبارات، افتح «الاختبار التفاعلي»، ثم اختر المستوى والمقرر والنموذج المتاح. بعد إنهاء الاختبار يمكنك مشاهدة النتيجة ومراجعة الإجابات.`;
}

const MINI_APP_URL = 'https://app8964547541.tgcloud.ai/?v=20261030-ehsan-ui-final3';
const ADMIN_APP_URL = 'https://app8964547541.tgcloud.ai/admin.html?v=20261030-ehsan-ui-final2';

export function homeKeyboard(isAdmin = false) {
  const rows = [
    [{ text: '📱 الاختبار التفاعلي', web_app: { url: MINI_APP_URL } }],
  ];
  if (isAdmin) rows.push([{ text: '⚙️ لوحة الإدارة', web_app: { url: ADMIN_APP_URL } }]);
  // The bot now directs learners to the college's interactive exam platform only.
  return { inline_keyboard: rows };
}

export function helpKeyboard(isAdmin = false) {
  const rows = [
    [{ text: '📱 فتح الاختبار التفاعلي', web_app: { url: MINI_APP_URL } }],
  ];
  if (isAdmin) rows.push([{ text: '⚙️ لوحة الإدارة', web_app: { url: ADMIN_APP_URL } }]);
  rows.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'menu:home' }]);
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
