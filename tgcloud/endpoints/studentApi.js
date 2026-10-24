import { EndpointError } from 'sdk';
import { supabaseStudentRequest } from '../lib/supabase-students.js';
import { fetch } from 'sdk/fetch';

const ALLOWED_ACTIONS = new Set(['me', 'leaderboard', 'startAttempt', 'saveProgress', 'completeAttempt', 'abandonAttempt']);

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
  return await supabaseStudentRequest(action, input.payload || {}, auth);
}
