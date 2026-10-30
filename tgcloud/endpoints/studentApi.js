import { EndpointError } from 'sdk';
import { supabaseStudentRequest } from '../lib/supabase-students.js';
import { fetch } from 'sdk/fetch';

const ALLOWED_ACTIONS = new Set(['appAuth', 'me', 'leaderboard', 'startAttempt', 'saveProgress', 'completeAttempt', 'abandonAttempt']);
const SHARED_ACCOUNT_ACTIONS = new Set(['me', 'startAttempt', 'saveProgress', 'completeAttempt', 'abandonAttempt']);
const BROWSER_STUDENT_DATA_URL = 'https://jrrsnpijbizbwxopyvam.supabase.co/functions/v1/browser-student-data';

export default async function (input = {}, ctx) {
  const user = ctx?.initData?.user;
  const telegramId = Number(user?.id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
    throw new EndpointError('افتح المنصة من داخل Telegram حتى نتحقق من حسابك ونحفظ تقدمك.', {
      code: 'TELEGRAM_REQUIRED',
    });
  }

  const action = typeof input.action === 'string' ? input.action : '';
  if (!ALLOWED_ACTIONS.has(action)) {
    throw new EndpointError('العملية المطلوبة غير معروفة.', { code: 'UNKNOWN_ACTION' });
  }

  const auth = {
    telegramId,
    profile: {
      username: typeof user.username === 'string' ? user.username : '',
      first_name: typeof user.first_name === 'string' ? user.first_name : '',
      last_name: typeof user.last_name === 'string' ? user.last_name : '',
      photo_url: typeof user.photo_url === 'string' ? user.photo_url : '',
    },
  };

  if (action === 'leaderboard') {
    let response;
    try { response = await fetch('https://jrrsnpijbizbwxopyvam.supabase.co/functions/v1/public-leaderboard', { method: 'GET' }); }
    catch { throw new EndpointError('تعذر الاتصال بلوحة الصدارة. حاول مرة أخرى.', { code: 'LEADERBOARD_UNAVAILABLE' }); }
    let result;
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok || !Array.isArray(result.leaderboard)) throw new EndpointError('تعذر تحميل بيانات لوحة الصدارة.', { code: 'LEADERBOARD_ERROR' });
    return { leaders: result.leaderboard, totalStudents: result.totalStudents || 0 };
  }
  if (SHARED_ACCOUNT_ACTIONS.has(action)) {
    const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
    if (!accessToken || accessToken.length > 5000) {
      throw new EndpointError('انتهت جلسة الحساب. أغلق المنصة وافتحها مجددًا من Telegram.', { code: 'AUTH_REQUIRED' });
    }
    let response;
    try {
      response = await fetch(BROWSER_STUDENT_DATA_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + accessToken,
        },
        body: JSON.stringify({ action, payload: input.payload || {}, telegramId }),
      });
    } catch {
      throw new EndpointError('تعذر الاتصال بخدمة حفظ تقدم الطالب. حاول مرة أخرى.', { code: 'STUDENT_DATA_UNAVAILABLE' });
    }
    let result;
    try { result = await response.json(); } catch { result = {}; }
    if (!response.ok) {
      throw new EndpointError(result.error || 'تعذر تحميل بيانات حساب الطالب.', { code: 'STUDENT_DATA_ERROR' });
    }
    return result;
  }

  return await supabaseStudentRequest(action, input.payload || {}, auth);
}
