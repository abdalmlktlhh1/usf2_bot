import { api, db } from 'sdk';
import { auditLogs } from '../schema.js';
import { getAdminContext } from './adminAccess.js';
import {
  getModelUploadState,
  saveModelUploadState,
  clearModelUploadState,
  MODEL_UPLOAD_SYSTEMS,
  MODEL_UPLOAD_AUDIENCES,
  MODEL_UPLOAD_PERIODS,
} from './model-upload.js';
import { supabaseContentRequest } from './supabase-content.js';

const hasPermission = (auth, key) => Boolean(auth?.isOwner || auth?.permissions?.includes('*') || auth?.permissions?.includes(key));
const canUpload = (auth) => Boolean(auth && auth.featureFlags?.modelImport === true &&
  hasPermission(auth, 'questions.write'));
const buttonRows = (items, prefix, width = 2) => {
  const rows = [];
  for (let i = 0; i < items.length; i += width) {
    rows.push(items.slice(i, i + width).map(([label, value]) => ({
      text: String(label).slice(0, 60),
      callback_data: prefix + ':' + value,
    })));
  }
  return rows;
};
async function edit(query, text, keyboard) {
  const payload = {
    chat_id: query.message.chat.id,
    message_id: query.message.message_id,
    text,
  };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  await api.editMessageText(payload);
}
async function answer(query, text, alert = false) {
  await api.answerCallbackQuery({
    callback_query_id: query.id,
    ...(text ? { text: String(text).slice(0, 180) } : {}),
    ...(alert ? { show_alert: true } : {}),
  });
}
function scopeCourses(auth, courses) {
  const scope = Array.isArray(auth.scopeCourseIds) ? auth.scopeCourseIds : [];
  return (courses || []).filter(course =>
    auth.isOwner || scope.includes('*') || scope.map(Number).includes(Number(course.id))
  );
}
async function getCatalog(auth) {
  return await supabaseContentRequest('dashboardSummary', {}, auth);
}
async function logImport(auth, result, state, useAI) {
  try {
    await db.insert(auditLogs).values({
      actorId: Number(auth.telegramId),
      actorName: String(auth.actorName || 'مشرف'),
      action: 'import_json',
      entityType: 'model',
      entityId: 0,
      details: {
        courseId: result.courseId,
        sourceYear: result.sourceYear,
        sourceFile: result.sourceFile,
        imported: result.imported,
        useAI,
        source: 'telegram_bot',
        fileName: state.fileName || '',
      },
      createdAt: Date.now(),
    }).run();
  } catch (error) {
    console.error('Failed to record Telegram model import audit event', error);
  }
}

export async function handleModelUploadCallback(query) {
  const data = typeof query?.data === 'string' ? query.data : '';
  const isStart = data === 'menu:action:upload_model';
  const match = /^modelupload:(cancel|level|course|system|year|audience|period|ai)(?::([^:]+))?$/.exec(data);
  if (!isStart && !match) return false;

  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  const userId = Number(query.from?.id);
  if (!chatId || !messageId || !Number.isSafeInteger(userId) || userId <= 0) {
    await answer(query, 'تعذر التحقق من المستخدم أو المحادثة.', true);
    return true;
  }

  let answered = false;
  try {
    const auth = await getAdminContext(userId, query.from);
    if (!canUpload(auth)) {
      await answer(query, 'رفع النماذج غير مفعّل لحسابك، أو تنقصك صلاحية تعديل الأسئلة.', true);
      return true;
    }

    if (isStart) {
      await saveModelUploadState(userId, { step: 'await_file', startedAt: Date.now() });
      await answer(query);
      await api.sendMessage({
        chat_id: chatId,
        text: 'رفع نموذج جديد إلى منصة إحسان\n\nأرسل ملف JSON يحتوي مصفوفة الأسئلة أو كائنًا يتضمن questions. الحد الأقصى 2 ميجابايت و500 سؤال.\n\nيمكنك إرسال /cancel في أي وقت لإلغاء العملية.',
      });
      return true;
    }

    const [, action, rawValue] = match;
    if (action === 'cancel') {
      await clearModelUploadState(userId);
      await answer(query, 'تم إلغاء عملية رفع النموذج.');
      await edit(query, 'تم إلغاء رفع النموذج وحذف بيانات العملية المؤقتة.');
      return true;
    }

    const state = await getModelUploadState(userId);
    if (!state || !Array.isArray(state.questions) || state.questions.length === 0) {
      await answer(query, 'لم أجد ملفًا قيد الرفع. ابدأ عملية جديدة من زر رفع نموذج JSON.', true);
      return true;
    }

    if (action === 'level') {
      if (state.step !== 'choose_level') throw new Error('انتهت خطوة اختيار المستوى؛ أعد إرسال الملف.');
      const levelId = Number(rawValue);
      const catalog = await getCatalog(auth);
      const courses = scopeCourses(auth, catalog.courses || []);
      const subjects = catalog.subjects || [];
      const subjectIds = new Set(subjects.filter(row => Number(row.levelId) === levelId).map(row => Number(row.id)));
      const level = (catalog.levels || []).find(row => Number(row.id) === levelId);
      if (!level || !courses.some(course => subjectIds.has(Number(course.subjectId)))) throw new Error('المستوى المحدد غير متاح ضمن صلاحياتك.');
      const nextCourses = courses.filter(course => subjectIds.has(Number(course.subjectId)));
      await saveModelUploadState(userId, { ...state, step: 'choose_course', levelId });
      const rows = buttonRows(nextCourses.slice(0, 80).map(course => {
        const subject = subjects.find(row => Number(row.id) === Number(course.subjectId));
        return [String(course.name) + (subject?.name ? ' · ' + subject.name : ''), course.id];
      }), 'modelupload:course', 1);
      rows.push([{ text: 'إلغاء', callback_data: 'modelupload:cancel' }]);
      await answer(query);
      await edit(query, 'المستوى: ' + level.name + '\nاختر المقرر الذي يتبع له النموذج:', rows);
      return true;
    }

    if (action === 'course') {
      if (state.step !== 'choose_course') throw new Error('اختر المستوى أولًا.');
      const courseId = Number(rawValue);
      const catalog = await getCatalog(auth);
      const course = scopeCourses(auth, catalog.courses || []).find(row => Number(row.id) === courseId);
      const subject = (catalog.subjects || []).find(row => Number(row.id) === Number(course?.subjectId));
      if (!course || !subject || Number(subject.levelId) !== Number(state.levelId)) throw new Error('المقرر لا يتبع المستوى المحدد أو أنه خارج نطاق صلاحياتك.');
      await saveModelUploadState(userId, { ...state, step: 'choose_system', courseId });
      const rows = buttonRows(Object.entries(MODEL_UPLOAD_SYSTEMS).map(([key, label]) => [label, key]), 'modelupload:system');
      rows.push([{ text: 'إلغاء', callback_data: 'modelupload:cancel' }]);
      await answer(query);
      await edit(query, 'المقرر: ' + course.name + '\nاختر النظام الدراسي:', rows);
      return true;
    }

    if (action === 'system') {
      if (state.step !== 'choose_system' || !Object.hasOwn(MODEL_UPLOAD_SYSTEMS, rawValue)) throw new Error('اختيار النظام الدراسي غير صالح.');
      const sourceSystem = MODEL_UPLOAD_SYSTEMS[rawValue];
      await saveModelUploadState(userId, { ...state, step: 'choose_year', sourceSystem });
      const currentYear = new Date().getFullYear();
      const years = Array.from({ length: 12 }, (_, index) => currentYear - 6 + index)
        .map(year => [String(year), String(year)]);
      const rows = buttonRows(years, 'modelupload:year', 3);
      rows.push([{ text: 'إدخال سنة أخرى', callback_data: 'modelupload:year:other' }]);
      rows.push([{ text: 'إلغاء', callback_data: 'modelupload:cancel' }]);
      await answer(query);
      await edit(query, 'النظام الدراسي: ' + sourceSystem + '\nاختر سنة النموذج:', rows);
      return true;
    }

    if (action === 'year') {
      if (state.step !== 'choose_year') throw new Error('اختر النظام الدراسي أولًا.');
      if (rawValue === 'other') {
        await saveModelUploadState(userId, { ...state, step: 'await_year' });
        await answer(query);
        await edit(query, 'أرسل سنة النموذج بالأرقام، مثل 2019 أو 2032. أرسل /cancel للإلغاء.');
        return true;
      }
      const sourceYear = Number(rawValue);
      if (!Number.isInteger(sourceYear) || sourceYear < 0 || sourceYear > 2100) throw new Error('سنة النموذج غير صالحة.');
      await saveModelUploadState(userId, { ...state, step: 'choose_audience', sourceYear });
      const rows = buttonRows(Object.entries(MODEL_UPLOAD_AUDIENCES).map(([key, label]) => [label, key]), 'modelupload:audience');
      rows.push([{ text: 'إلغاء', callback_data: 'modelupload:cancel' }]);
      await answer(query);
      await edit(query, 'السنة: ' + sourceYear + '\nاختر الفئة المستهدفة:', rows);
      return true;
    }

    if (action === 'audience') {
      if (state.step !== 'choose_audience' || !Object.hasOwn(MODEL_UPLOAD_AUDIENCES, rawValue)) throw new Error('الفئة المستهدفة غير صالحة.');
      const sourceAudience = MODEL_UPLOAD_AUDIENCES[rawValue];
      await saveModelUploadState(userId, { ...state, step: 'choose_period', sourceAudience });
      const rows = buttonRows(Object.entries(MODEL_UPLOAD_PERIODS), 'modelupload:period');
      rows.push([{ text: 'إلغاء', callback_data: 'modelupload:cancel' }]);
      await answer(query);
      await edit(query, 'الفئة: ' + sourceAudience + '\nاختر فترة النموذج:', rows);
      return true;
    }

    if (action === 'period') {
      if (state.step !== 'choose_period' || !Object.hasOwn(MODEL_UPLOAD_PERIODS, rawValue)) throw new Error('فترة النموذج غير صالحة.');
      const sourceFile = MODEL_UPLOAD_PERIODS[rawValue];
      await saveModelUploadState(userId, { ...state, step: 'choose_ai', sourceFile });
      const rows = [];
      if (auth.isOwner || auth.featureFlags?.assistant === true) {
        rows.push([{ text: 'نعم، صنّف بالذكاء الاصطناعي', callback_data: 'modelupload:ai:1' }]);
      }
      rows.push([{ text: 'استورد كما هو', callback_data: 'modelupload:ai:0' }]);
      rows.push([{ text: 'إلغاء', callback_data: 'modelupload:cancel' }]);
      await answer(query);
      await edit(query, 'الفترة: ' + sourceFile + '\nهل تريد من المساعد الذكي تصنيف موضوعات الأسئلة؟ لن يغيّر نصوصها أو خياراتها ولن يخمّن الإجابات غير المحددة.', rows);
      return true;
    }

    if (action === 'ai') {
      if (state.step !== 'choose_ai') throw new Error('أكمل بيانات النموذج أولًا.');
      const useAI = rawValue === '1';
      if (!['0', '1'].includes(rawValue)) throw new Error('خيار المساعد الذكي غير صالح.');
      if (useAI && auth.isOwner !== true && auth.featureFlags?.assistant !== true) {
        throw new Error('لم يفعّل المالك المساعد الذكي لحسابك.');
      }
      await answer(query, useAI ? 'جارٍ تحليل الأسئلة واستيراد النموذج…' : 'جارٍ استيراد النموذج…');
      answered = true;
      await edit(query, 'جارٍ استيراد ' + state.questions.length + ' سؤالًا إلى منصة إحسان. قد يستغرق تحليل الذكاء الاصطناعي بعض الوقت…');
      const result = await supabaseContentRequest('importModelJson', {
        levelId: Number(state.levelId),
        courseId: Number(state.courseId),
        sourceYear: Number(state.sourceYear),
        sourceSystem: String(state.sourceSystem),
        sourceAudience: String(state.sourceAudience),
        sourceFile: String(state.sourceFile),
        questions: state.questions,
        useAI,
      }, auth);
      await logImport(auth, result, state, useAI);
      await clearModelUploadState(userId);
      const missing = Number(result.awaitingAnswer || 0);
      const text = result.skipped
        ? 'لم تُكرر الأسئلة؛ يوجد نموذج مسجل مسبقًا بالمحتوى نفسه.\nعدد الأسئلة الموجودة: ' + Number(result.existing || 0)
        : 'اكتمل استيراد النموذج إلى قاعدة بيانات إحسان.\n\nالأسئلة المضافة: ' + Number(result.imported || 0) +
          '\nالأسئلة بلا إجابة محددة: ' + missing +
          (useAI ? '\nتم إرفاق تصنيفات موضوعية مقترحة للأسئلة.' : '') +
          '\n\nيمكن للمشرف المخوّل تحديد الإجابات الصحيحة من صفحة الاختبار.';
      await edit(query, text);
      return true;
    }
    return true;
  } catch (error) {
    if (!answered) await answer(query, String(error?.message || 'تعذر تنفيذ الخطوة.'), true);
    else await edit(query, 'تعذر إكمال استيراد النموذج: ' + String(error?.message || 'خطأ غير معروف').slice(0, 500) + '\nلم يتم تأكيد اكتمال الاستيراد.');
    return true;
  }
}
