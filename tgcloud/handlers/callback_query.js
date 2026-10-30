import { api, db } from 'sdk';
import { and, eq } from 'sdk/db';
import { quizSessions } from '../schema.js';
import {
  QUESTIONS,
  homeText,
  helpText,
  questionText,
  questionKeyboard,
  resultText,
  resultKeyboard,
} from '../lib/quiz.js';
import { isAdminUser } from '../lib/adminAccess.js';
import { getBotMenuKeyboard, getBotMenuItem, isBotMenuItemVisible } from '../lib/bot-menu.js';

function makeSessionId(chatId, userId) {
  return `${chatId}:${userId}`;
}

function makeSessionToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function startQuizInMessage(chatId, userId, messageId) {
  const sessionId = makeSessionId(chatId, userId);
  const sessionToken = makeSessionToken();
  await db.insert(quizSessions).values({
    sessionId,
    userId,
    chatId,
    sessionToken,
    messageId,
    questionIndex: 0,
    score: 0,
  }).onConflictDoUpdate({
    target: quizSessions.sessionId,
    set: {
      userId,
      chatId,
      sessionToken,
      messageId,
      questionIndex: 0,
      score: 0,
    },
  }).run();

  await api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text: questionText(0),
    reply_markup: questionKeyboard(0),
  });
}

async function showMenu(chatId, userId, messageId, isHelp) {
  const sessionId = makeSessionId(chatId, userId);
  await db.delete(quizSessions).where(eq(quizSessions.sessionId, sessionId)).run();
  const isAdmin = await isAdminUser(userId);

  await api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text: isHelp ? helpText() : homeText(),
    reply_markup: await getBotMenuKeyboard(isAdmin),
  });
}

export default async function (query) {
  if (!query?.id) return;

  const data = typeof query.data === 'string' ? query.data : '';
  const message = query.message;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;
  const userId = query.from?.id;

  // Old Telegram messages may still contain buttons from the retired text-only demo.
  if (data === 'quiz:start' || data.startsWith('quiz:answer:') || data === 'menu:action:quiz' || data === 'menu:action:about') {
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: 'الاختبار النصي داخل المحادثة لم يعد متاحًا. افتح «الاختبار التفاعلي» من القائمة.',
      show_alert: true,
    });
    return;
  }

  const openMenuMatch = /^menu:open:(\d+)$/.exec(data);
  if (openMenuMatch) {
    if (!chatId || !messageId || !userId) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'تعذّر فتح القائمة.', show_alert: true });
      return;
    }
    const item = await getBotMenuItem(Number(openMenuMatch[1]));
    const isAdmin = await isAdminUser(userId);
    if (!item || item.type !== 'submenu' || !(await isBotMenuItemVisible(item.id, isAdmin))) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'هذه القائمة غير متاحة.', show_alert: true });
      return;
    }
    await api.answerCallbackQuery({ callback_query_id: query.id });
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: item.description || ('📂 ' + item.text + '\n\nاختر أحد الأزرار التالية:'),
      reply_markup: await getBotMenuKeyboard(isAdmin, Number(item.id)),
    });
    return;
  }

  const menuMessageMatch = /^menu:message:(\d+)$/.exec(data);
  if (menuMessageMatch) {
    if (!chatId || !messageId || !userId) {
      await api.answerCallbackQuery({ callback_query_id: query.id });
      return;
    }
    const item = await getBotMenuItem(Number(menuMessageMatch[1]));
    const isAdmin = await isAdminUser(userId);
    if (!item || item.type !== 'message' || !(await isBotMenuItemVisible(item.id, isAdmin))) {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'هذا الزر غير متاح.', show_alert: true });
      return;
    }
    await api.answerCallbackQuery({ callback_query_id: query.id });
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: item.description,
      reply_markup: await getBotMenuKeyboard(isAdmin, item.parentId == null ? null : Number(item.parentId)),
    });
    return;
  }

  const menuActionMatch = /^menu:action:(help|about|home)$/.exec(data);
  if (menuActionMatch) {
    if (!chatId || !messageId || !userId) {
      await api.answerCallbackQuery({ callback_query_id: query.id });
      return;
    }
    const action = menuActionMatch[1];
    await api.answerCallbackQuery({ callback_query_id: query.id });
    if (action === 'home' || action === 'help') {
      await showMenu(chatId, userId, messageId, action === 'help');
      return;
    }
    const isAdmin = await isAdminUser(userId);
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: 'بوت الاختبارات 🎓\n\nمنصة نماذج الاختبارات لكلية الشريعة والقانون — جامعة صنعاء.',
      reply_markup: await getBotMenuKeyboard(isAdmin),
    });
    return;
  }

  if (data === 'quiz:start') {
    if (!chatId || !messageId || !userId) {
      await api.answerCallbackQuery({
        callback_query_id: query.id,
        text: 'تعذّر بدء الاختبار من هذه الرسالة.',
        show_alert: true,
      });
      return;
    }

    await api.answerCallbackQuery({ callback_query_id: query.id });
    await startQuizInMessage(chatId, userId, messageId);
    return;
  }

  if (data === 'menu:help' || data === 'menu:home') {
    if (!chatId || !messageId || !userId) {
      await api.answerCallbackQuery({ callback_query_id: query.id });
      return;
    }

    await api.answerCallbackQuery({ callback_query_id: query.id });
    await showMenu(chatId, userId, messageId, data === 'menu:help');
    return;
  }

  const match = /^quiz:answer:(\d+):(\d+)$/.exec(data);
  if (!match) {
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: 'هذا الزر قديم أو غير صالح. افتح «الاختبار التفاعلي» من القائمة.',
      show_alert: true,
    });
    return;
  }

  if (!chatId || !messageId || !userId) {
    await api.answerCallbackQuery({ callback_query_id: query.id });
    return;
  }

  const questionIndex = Number(match[1]);
  const optionIndex = Number(match[2]);
  const question = QUESTIONS[questionIndex];

  if (!Number.isSafeInteger(questionIndex) ||
      !Number.isSafeInteger(optionIndex) ||
      !question ||
      optionIndex < 0 ||
      optionIndex >= question.options.length) {
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: 'السؤال أو الاختيار غير صالح. افتح «الاختبار التفاعلي» من القائمة.',
      show_alert: true,
    });
    return;
  }

  const sessionId = makeSessionId(chatId, userId);
  const session = await db.select()
    .from(quizSessions)
    .where(eq(quizSessions.sessionId, sessionId))
    .get();

  if (!session ||
      session.messageId !== messageId ||
      session.questionIndex !== questionIndex) {
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: 'هذا السؤال انتهى أو لم يعد نشطًا. افتح «الاختبار التفاعلي» من القائمة.',
      show_alert: true,
    });
    return;
  }

  const isCorrect = optionIndex === question.correct;
  const nextIndex = questionIndex + 1;
  const nextScore = session.score + (isCorrect ? 1 : 0);

  // Compare-and-update makes duplicate or simultaneous clicks count only once.
  const update = await db.update(quizSessions)
    .set({ questionIndex: nextIndex, score: nextScore })
    .where(and(
      eq(quizSessions.sessionId, sessionId),
      eq(quizSessions.messageId, messageId),
      eq(quizSessions.questionIndex, questionIndex),
    ))
    .run();

  if (update.rowsAffected !== 1) {
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: 'تم تسجيل إجابة هذا السؤال بالفعل.',
      show_alert: true,
    });
    return;
  }

  await api.answerCallbackQuery({ callback_query_id: query.id });

  const feedback = isCorrect
    ? `إجابة صحيحة ✅\n${question.explanation}`
    : `إجابة غير صحيحة ❌\nالإجابة الصحيحة: ${question.options[question.correct]}\n${question.explanation}`;

  if (nextIndex < QUESTIONS.length) {
    await api.editMessageText({
      chat_id: chatId,
      message_id: messageId,
      text: `${feedback}\n\n${questionText(nextIndex)}`,
      reply_markup: questionKeyboard(nextIndex),
    });
    return;
  }

  await api.editMessageText({
    chat_id: chatId,
    message_id: messageId,
    text: `${feedback}\n\n${resultText(nextScore)}`,
    reply_markup: resultKeyboard(),
  });
}
