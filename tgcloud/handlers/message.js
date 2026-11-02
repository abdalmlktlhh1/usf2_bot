import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { quizSessions, siteSettings } from '../schema.js';
import {
  homeText,
  questionText,
  questionKeyboard,
} from '../lib/quiz.js';
import { getAdminContext } from '../lib/adminAccess.js';
import { getBotMenuKeyboard } from '../lib/bot-menu.js';
import {
  getModelUploadState,
  saveModelUploadState,
  clearModelUploadState,
} from '../lib/model-upload.js';
import { supabaseContentRequest } from '../lib/supabase-content.js';

function makeSessionId(chatId, userId) {
  return `${chatId}:${userId}`;
}
function makeSessionToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function hasPermission(auth, permission) {
  return Boolean(auth?.isOwner || auth?.permissions?.includes('*') || auth?.permissions?.includes(permission));
}
function canUpload(auth) {
  return Boolean(auth && auth.featureFlags?.modelImport === true &&
    hasPermission(auth, 'questions.write'));
}
async function beginQuiz(chatId, userId) {
  const sessionId = makeSessionId(chatId, userId);
  const sessionToken = makeSessionToken();
  await db.insert(quizSessions).values({
    sessionId, userId, chatId, sessionToken, messageId: 0, questionIndex: 0, score: 0,
  }).onConflictDoUpdate({
    target: quizSessions.sessionId,
    set: { userId, chatId, sessionToken, messageId: 0, questionIndex: 0, score: 0 },
  }).run();
  const sent = await api.sendMessage({
    chat_id: chatId, text: questionText(0), reply_markup: questionKeyboard(0),
  });
  await db.update(quizSessions).set({ messageId: sent.message_id })
    .where(eq(quizSessions.sessionToken, sessionToken)).run();
}
function isJsonFile(document) {
  return String(document?.file_name || '').toLowerCase().endsWith('.json');
}
async function showUploadYearPrompt(chatId) {
  await api.sendMessage({
    chat_id: chatId,
    text: 'تم استلام ملف الأسئلة. أرسل سنة النموذج بالأرقام، مثل 2025 أو 2026. أرسل /cancel لإلغاء العملية.',
  });
}
async function handleUploadDocument(message, auth) {
  const { chat } = message;
  const document = message.document;
  if (!canUpload(auth)) {
    await api.sendMessage({ chat_id: chat.id, text: 'رفع النماذج غير مفعّل لحسابك، أو تنقصك صلاحية إضافة الأسئلة ونشرها.' });
    return;
  }
  const state = await getModelUploadState(message.from.id);
  if (!state || state.step !== 'await_file') {
    await api.sendMessage({ chat_id: chat.id, text: 'ابدأ أولًا من زر «رفع نموذج JSON» في قائمة البوت، ثم أرسل الملف.' });
    return;
  }
  if (!isJsonFile(document)) {
    await api.sendMessage({ chat_id: chat.id, text: 'الملف المطلوب يجب أن يكون بصيغة JSON وينتهي اسمه بـ .json.' });
    return;
  }
  if (Number(document.file_size || 0) > 2 * 1024 * 1024) {
    await api.sendMessage({ chat_id: chat.id, text: 'حجم الملف يتجاوز الحد المسموح (2 ميجابايت). قلّل حجم JSON ثم أعد إرساله.' });
    return;
  }
  try {
    const bytes = await api.getFileContent(document.file_id);
    if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('حجم الملف يتجاوز 2 ميجابايت.');
    const rawText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(rawText);
    const questions = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.questions) ? parsed.questions : null);
    if (!questions || questions.length < 1 || questions.length > 500) {
      throw new Error('يجب أن يحتوي الملف على مصفوفة أسئلة من سؤال واحد إلى 500 سؤال.');
    }
    const catalog = await supabaseContentRequest('dashboardSummary', {}, auth);
    const allowedIds = Array.isArray(auth.scopeCourseIds) ? auth.scopeCourseIds : [];
    const permittedCourses = (catalog.courses || []).filter(course =>
      auth.isOwner || allowedIds.includes('*') || allowedIds.map(Number).includes(Number(course.id))
    );
    const allowedSubjects = new Set(permittedCourses.map(course => Number(course.subjectId)));
    const permittedLevels = (catalog.levels || []).filter(level =>
      (catalog.subjects || []).some(subject =>
        Number(subject.levelId) === Number(level.id) && allowedSubjects.has(Number(subject.id))
      )
    );
    if (!permittedLevels.length) throw new Error('لا توجد مقررات ضمن نطاق صلاحياتك لإضافة النموذج إليها.');
    await saveModelUploadState(message.from.id, {
      ...state,
      step: 'choose_level',
      fileName: String(document.file_name || 'questions.json').slice(0, 180),
      questions,
      levelIds: permittedLevels.map(level => Number(level.id)),
    });
    const keyboard = [];
    for (let i = 0; i < permittedLevels.length; i += 2) {
      keyboard.push(permittedLevels.slice(i, i + 2).map(level => ({
        text: String(level.name).slice(0, 60),
        callback_data: 'modelupload:level:' + level.id,
      })));
    }
    await api.sendMessage({
      chat_id: chat.id,
      text: 'تمت قراءة ' + questions.length + ' سؤالًا من الملف «' + String(document.file_name || 'JSON') + '».\nاختر المستوى الدراسي:',
      reply_markup: { inline_keyboard: keyboard },
    });
  } catch (error) {
    await api.sendMessage({
      chat_id: chat.id,
      text: 'تعذر قراءة الملف أو بنية الأسئلة غير صالحة: ' + String(error?.message || 'خطأ غير معروف').slice(0, 500) + '\nلم تُضف أي أسئلة إلى المنصة.',
    });
  }
}
async function handleUploadYear(message, auth, state) {
  if (!canUpload(auth)) {
    await clearModelUploadState(message.from.id);
    await api.sendMessage({ chat_id: message.chat.id, text: 'لم تعد صلاحية رفع النماذج متاحة لحسابك.' });
    return;
  }
  const year = Number(String(message.text || '').trim());
  if (!Number.isInteger(year) || year < 0 || year > 2100) {
    await api.sendMessage({ chat_id: message.chat.id, text: 'أرسل سنة صحيحة بالأرقام من 0 إلى 2100، أو أرسل /cancel للإلغاء.' });
    return;
  }
  await saveModelUploadState(message.from.id, { ...state, sourceYear: year, step: 'choose_audience' });
  await api.sendMessage({
    chat_id: message.chat.id,
    text: 'السنة: ' + year + '. اختر الفئة المستهدفة:',
    reply_markup: { inline_keyboard: [
      [{ text: 'الطلاب', callback_data: 'modelupload:audience:students' }, { text: 'الطالبات', callback_data: 'modelupload:audience:female' }],
    ] },
  });
}

export default async function (message) {
  if (!message?.chat?.id || !message?.from?.id) return;
  const chatId = message.chat.id;
  const userId = message.from.id;
  const auth = await getAdminContext(userId, message.from);
  const isAdmin = Boolean(auth);
  const sessionId = makeSessionId(chatId, userId);

  if (message.document) {
    await handleUploadDocument(message, auth);
    return;
  }
  if (typeof message.text !== 'string') return;
  const text = message.text.trim();
  const command = (text.split(/\s+/, 1)[0] || '').split('@', 1)[0].toLowerCase();

  if (command === '/cancel') {
    await clearModelUploadState(userId);
    await api.sendMessage({ chat_id: chatId, text: 'تم إلغاء رفع النموذج وحذف بيانات العملية المؤقتة.', reply_markup: await getBotMenuKeyboard(isAdmin, null, userId) });
    return;
  }
  const uploadState = await getModelUploadState(userId);
  if (uploadState?.step === 'await_year' && !text.startsWith('/')) {
    await handleUploadYear(message, auth, uploadState);
    return;
  }

  if (command === '/start') {
    await db.delete(quizSessions).where(eq(quizSessions.sessionId, sessionId)).run();
    await api.sendMessage({
      chat_id: chatId,
      text: homeText(),
      reply_markup: await getBotMenuKeyboard(isAdmin, null, userId),
    });
    return;
  }

  if (text.startsWith('/')) return;
  await api.sendMessage({
    chat_id: chatId,
    text: 'مرحبًا بك في منصة نماذج الاختبارات. افتح «الاختبار التفاعلي» من القائمة للبدء.',
    reply_markup: await getBotMenuKeyboard(isAdmin, null, userId),
  });
}
