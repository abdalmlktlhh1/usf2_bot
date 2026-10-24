import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { quizSessions } from '../schema.js';
import {
  QUESTIONS,
  homeText,
  helpText,
  questionText,
  questionKeyboard,
} from '../lib/quiz.js';
import { isAdminUser } from '../lib/adminAccess.js';
import { getBotMenuKeyboard } from '../lib/bot-menu.js';

function makeSessionId(chatId, userId) {
  return `${chatId}:${userId}`;
}

function makeSessionToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function beginQuiz(chatId, userId) {
  const sessionId = makeSessionId(chatId, userId);
  const sessionToken = makeSessionToken();

  await db.insert(quizSessions).values({
    sessionId,
    userId,
    chatId,
    sessionToken,
    messageId: 0,
    questionIndex: 0,
    score: 0,
  }).onConflictDoUpdate({
    target: quizSessions.sessionId,
    set: {
      userId,
      chatId,
      sessionToken,
      messageId: 0,
      questionIndex: 0,
      score: 0,
    },
  }).run();

  const sent = await api.sendMessage({
    chat_id: chatId,
    text: questionText(0),
    reply_markup: questionKeyboard(0),
  });

  // Only attach the message if this is still the latest start request.
  await db.update(quizSessions)
    .set({ messageId: sent.message_id })
    .where(eq(quizSessions.sessionToken, sessionToken))
    .run();
}

export default async function (message) {
  if (!message?.chat?.id || !message?.from?.id) return;
  if (typeof message.text !== 'string') return;

  const chatId = message.chat.id;
  const userId = message.from.id;
  const text = message.text.trim();
  const command = (text.split(/\s+/, 1)[0] || '').split('@', 1)[0].toLowerCase();
  const sessionId = makeSessionId(chatId, userId);

  const isAdmin = await isAdminUser(userId);

  if (command === '/start') {
    // Invalidate any old quiz buttons for this user in this chat.
    await db.delete(quizSessions).where(eq(quizSessions.sessionId, sessionId)).run();
    await api.sendMessage({
      chat_id: chatId,
      text: homeText(),
      reply_markup: await getBotMenuKeyboard(isAdmin),
    });
    return;
  }

  if (command === '/quiz' || command === '/test') {
    await beginQuiz(chatId, userId);
    return;
  }

  if (command === '/help') {
    await api.sendMessage({
      chat_id: chatId,
      text: helpText(),
      reply_markup: await getBotMenuKeyboard(isAdmin),
    });
    return;
  }

  if (command === '/about') {
    await api.sendMessage({
      chat_id: chatId,
      text: `بوت الاختبارات 🎓\n\nالإصدار الحالي يوفّر اختبارًا تجريبيًا من ${QUESTIONS.length} أسئلة، مع تصحيح فوري واحتساب النتيجة. الأسئلة قابلة للتخصيص حسب المقرر.`,
      reply_markup: await getBotMenuKeyboard(isAdmin),
    });
    return;
  }

  if (command === '/id') {
    await api.sendMessage({
      chat_id: chatId,
      text: `معرّف المحادثة: ${chatId}\nمعرّف حسابك: ${userId}`,
    });
    return;
  }

  if (command === '/cancel') {
    await db.delete(quizSessions).where(eq(quizSessions.sessionId, sessionId)).run();
    await api.sendMessage({
      chat_id: chatId,
      text: 'تم إلغاء الاختبار الحالي. يمكنك بدء اختبار جديد في أي وقت باستخدام /quiz.',
      reply_markup: await getBotMenuKeyboard(isAdmin),
    });
    return;
  }

  await api.sendMessage({
    chat_id: chatId,
    text: text.startsWith('/')
      ? 'هذا الأمر غير معروف. استخدم /help لمعرفة الأوامر المتاحة.'
      : 'مرحبًا بك! استخدم الأزرار أدناه أو أرسل /quiz لبدء الاختبار.',
    reply_markup: await getBotMenuKeyboard(isAdmin),
  });
}
