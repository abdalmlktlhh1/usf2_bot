import { db, EndpointError } from 'sdk';
import { and, desc, eq } from 'sdk/db';
import { questionReports } from '../schema.js';

const clean = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const TYPES = new Set(['wrong_answer','question_error','choices_error','duplicate','formatting','other']);
export default async function(input = {}, ctx) {
  const user = ctx?.initData?.user;
  const telegramId = Number(user?.id);
  if (!Number.isSafeInteger(telegramId) || telegramId <= 0) throw new EndpointError('افتح المنصة من داخل Telegram لإرسال البلاغ.', {code:'TELEGRAM_REQUIRED'});
  const questionId = clean(input.questionId, 180);
  const reportType = clean(input.reportType, 40);
  const courseId = Number(input.courseId || 0);
  if (!questionId || !TYPES.has(reportType) || !Number.isSafeInteger(courseId) || courseId < 0) throw new EndpointError('بيانات البلاغ غير مكتملة.', {code:'INVALID_REPORT'});
  const recentDuplicate = await db.select().from(questionReports)
    .where(and(eq(questionReports.telegramId, telegramId), eq(questionReports.questionId, questionId), eq(questionReports.status, 'open')))
    .orderBy(desc(questionReports.createdAt)).get();
  if (recentDuplicate && Date.now() - Number(recentDuplicate.createdAt) < 86400000) return {ok:true, duplicate:true, message:'سبق إرسال بلاغ مفتوح لهذا السؤال.'};
  const report = {
    id: crypto.randomUUID(), telegramId, username:clean(user?.username,64),
    displayName:[clean(user?.first_name,60),clean(user?.last_name,60)].filter(Boolean).join(' ') || 'طالب',
    questionId, questionText:clean(input.questionText,1500), courseId,
    course:clean(input.course,120), sourceYear:Number(input.sourceYear)||0,
    sourceFile:clean(input.sourceFile,300), reportType, details:clean(input.details,1000),
    status:'open',
    priority:['wrong_answer','question_error','choices_error'].includes(reportType)?'high':'normal',
    assignedTo:null, assignedName:'', resolutionNote:'', resolutionCode:'', duplicateOf:null,
    createdAt:Date.now(), updatedAt:Date.now(), lastActionBy:null, resolvedAt:null, resolvedBy:null,
  };
  await db.insert(questionReports).values(report).run();
  return {ok:true, reportId:report.id};
}
