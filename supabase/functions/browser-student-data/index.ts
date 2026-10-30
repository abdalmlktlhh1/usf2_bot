import { createClient } from "npm:@supabase/supabase-js@2";
const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const cors = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "https://app8964547541.tgcloud.ai",
  "Access-Control-Allow-Headers": "content-type,authorization,apikey",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: cors });
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const str = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const int = (value: unknown, fallback = 0) => Number.isSafeInteger(Number(value)) ? Number(value) : fallback;

async function assertCourseInAccountLevel(courseId: number, profile: any) {
  const { data: course, error: courseError } = await db.from("academic_courses")
    .select("id,subject_id,is_active").eq("id", courseId).maybeSingle();
  if (courseError) throw courseError;
  if (!course || course.is_active === false) throw fail("المقرر غير متاح.", 404);
  if (profile.role === "admin") return course;
  if (profile.level_id == null) throw fail("حسابك غير مرتبط بمستوى دراسي.", 403);

  const { data: subject, error: subjectError } = await db.from("academic_subjects")
    .select("id,level_id,is_active").eq("id", course.subject_id).maybeSingle();
  if (subjectError) throw subjectError;
  if (!subject || subject.is_active === false) throw fail("المادة غير متاحة.", 404);

  const { data: level, error: levelError } = await db.from("academic_levels")
    .select("id,is_active").eq("id", subject.level_id).maybeSingle();
  if (levelError) throw levelError;
  if (!level || level.is_active === false) throw fail("المستوى الدراسي غير متاح.", 404);
  if (Number(subject.level_id) !== Number(profile.level_id)) {
    throw fail("لا يمكن فتح أو حفظ محاولة في مقرر خارج المستوى المرتبط بحسابك.", 403);
  }
  return course;
}

Deno.serve(async (req: Request) => {
 if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
 if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
 try {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw fail("سجّل الدخول أولًا لعرض تقدمك المحفوظ.", 401);
  const { data: authData, error: authError } = await db.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user) throw fail("انتهت جلسة الدخول؛ سجّل الدخول مجددًا.", 401);
  const body = await req.json(), action = str(body.action, 40), p = body.payload || {};
  const { data: profile, error: profileError } = await db.from("app_student_profiles")
    .select("user_id,username,display_name,level_id,approval_status,role,telegram_id,academic_levels(name)")
    .eq("user_id", user.id).single();
  if (profileError || !profile) throw fail("لم يُعثر على ملف الحساب.", 403);
  if (profile.role !== "admin" && ["suspended", "blocked"].includes(String(profile.approval_status))) throw fail("هذا الحساب موقوف حاليًا.", 403);
  const requestedTelegramId = body.telegramId == null || body.telegramId === "" ? 0 : int(body.telegramId, -1);
  if (requestedTelegramId > 0 && Number(profile.telegram_id) !== requestedTelegramId) throw fail("حساب Telegram لا يطابق حساب الدخول.", 403);
  const level = Array.isArray(profile.academic_levels) ? profile.academic_levels[0]?.name : profile.academic_levels?.name;
  const legacyTelegramAccount = profile.telegram_id != null && Number.isSafeInteger(Number(profile.telegram_id));
  const accountColumn = legacyTelegramAccount ? "telegram_id" : "user_id";
  const accountId = legacyTelegramAccount ? Number(profile.telegram_id) : user.id;
  const attemptsTable = legacyTelegramAccount ? "student_attempts" : "app_student_attempts";
  const progressTable = legacyTelegramAccount ? "student_progress" : "app_student_progress";
  const progressConflict = legacyTelegramAccount
    ? "telegram_id,course_id,source_year,source_file"
    : "user_id,course_id,source_year,source_file";
  const accountMatches = (query: any) => query.eq(accountColumn, accountId);
  if (action === "me") {
   const [{ data: progress, error: pe }, { data: attempts, error: ae }] = await Promise.all([
    accountMatches(db.from(progressTable).select("*")).order("updated_at", { ascending: false }).limit(100),
    accountMatches(db.from(attemptsTable).select("*,academic_courses(name)")).order("started_at", { ascending: false }).limit(100)
   ]);
   if (pe) throw pe; if (ae) throw ae;
   return json({ profile: { user_id: user.id, username: profile.username, display_name: profile.display_name, level_id: profile.level_id, level_name: level, role: profile.role, last_seen_at: user.last_sign_in_at || null }, progress: progress || [], attempts: attempts || [] });
  }
  if (action === "mistakes") return json({ mistakes: [], activeCount: 0, masteredCount: 0 });
  if (action === "startAttempt") {
   const courseId = int(p.courseId, -1);
   if (courseId < 1) throw fail("المقرر غير صالح.");
   await assertCourseInAccountLevel(courseId, profile);
   const ids = Array.isArray(p.questionIds) ? [...new Set(p.questionIds.filter((x: unknown) => typeof x === "string" && x.length <= 300))].slice(0, 1000) : [];
   if (!ids.length) throw fail("لا توجد أسئلة صالحة لحفظ المحاولة.");
   const sourceYear = int(p.sourceYear), sourceFile = str(p.sourceFile), modelLabel = str(p.modelLabel, 250), now = new Date().toISOString();
   const { data: attempt, error } = await db.from(attemptsTable).insert({
    [accountColumn]: accountId, course_id: courseId, source_year: sourceYear, source_file: sourceFile, model_label: modelLabel,
    question_ids: ids, answers: {}, total_questions: ids.length, status: "in_progress", started_at: now, updated_at: now
   }).select("id,course_id,source_year,source_file,model_label,total_questions,status,started_at").single();
   if (error) throw error;
   const { error: pe } = await db.from(progressTable).upsert({
    [accountColumn]: accountId, course_id: courseId, source_year: sourceYear, source_file: sourceFile, attempt_id: attempt.id,
    current_index: 0, answers: {}, checked_question_ids: [], status: "in_progress", updated_at: now
   }, { onConflict: progressConflict });
   if (pe) throw pe;
   return json({ attempt });
  }
  if (action === "saveProgress") {
   const attemptId = str(p.attemptId, 64);
   const { data: attempt, error: ae } = await accountMatches(db.from(attemptsTable).select("*").eq("id", attemptId)).single();
   if (ae || !attempt) throw fail("المحاولة غير موجودة.", 404);
   if (attempt.status !== "in_progress") return json({ saved: true, currentIndex: attempt.total_questions - 1 });
   const ids = Array.isArray(attempt.question_ids) ? attempt.question_ids : [], raw = p.answers && typeof p.answers === "object" && !Array.isArray(p.answers) ? p.answers : {};
   const answers: Record<string, number> = {};
   for (const [key, value] of Object.entries(raw)) if (ids.includes(key) && Number.isInteger(value) && Number(value) >= 0 && Number(value) < 10) answers[key] = Number(value);
   const checked = Array.isArray(p.checkedQuestionIds) ? p.checkedQuestionIds.filter((x: unknown) => ids.includes(x)).slice(0, 1000) : [];
   const currentIndex = Math.max(0, Math.min(Math.max(0, ids.length - 1), int(p.currentIndex)));
   const now = new Date().toISOString();
   const { error } = await db.from(progressTable).upsert({
    [accountColumn]: accountId, course_id: attempt.course_id, source_year: attempt.source_year, source_file: attempt.source_file,
    attempt_id: attempt.id, current_index: currentIndex, answers, checked_question_ids: checked, status: "in_progress", updated_at: now
   }, { onConflict: progressConflict });
   if (error) throw error;
   const { error: updateError } = await accountMatches(db.from(attemptsTable).update({ answers, updated_at: now }).eq("id", attempt.id));
   if (updateError) throw updateError;
   return json({ saved: true, currentIndex });
  }
  if (action === "abandonAttempt") {
   const attemptId = str(p.attemptId, 64), now = new Date().toISOString();
   const { data: attempt, error } = await accountMatches(db.from(attemptsTable).select("id,course_id,source_year,source_file").eq("id", attemptId)).maybeSingle();
   if (error) throw error;
   if (attempt) {
    const { error: ae } = await accountMatches(db.from(attemptsTable).update({ status: "abandoned", updated_at: now }).eq("id", attemptId));
    if (ae) throw ae;
    const { error: pe } = await accountMatches(db.from(progressTable).update({ status: "abandoned", updated_at: now }).eq("attempt_id", attemptId));
    if (pe) throw pe;
   }
   return json({ abandoned: true });
  }
  if (action === "completeAttempt") {
   const attemptId = str(p.attemptId, 64);
   const { data: attempt, error: ae } = await accountMatches(db.from(attemptsTable).select("*").eq("id", attemptId)).single();
   if (ae || !attempt) throw fail("المحاولة غير موجودة.", 404);
   if (attempt.status === "completed") return json({ saved: true, alreadyCompleted: true });
   const ids = Array.isArray(attempt.question_ids) ? attempt.question_ids : [], raw = p.answers && typeof p.answers === "object" && !Array.isArray(p.answers) ? p.answers : {};
   const answers: Record<string, number> = {};
   for (const [key, value] of Object.entries(raw)) if (ids.includes(key) && Number.isInteger(value) && Number(value) >= 0 && Number(value) < 10) answers[key] = Number(value);
   const total = Math.max(0, Math.min(1000, int(p.totalQuestions, ids.length)));
   const graded = Math.max(0, Math.min(total, int(p.gradedQuestions)));
   const correct = Math.max(0, Math.min(graded, int(p.correctCount)));
   const wrong = Math.max(0, Math.min(graded - correct, int(p.wrongCount)));
   const blank = Math.max(0, Math.min(graded - correct - wrong, int(p.blankCount)));
   const pct = graded ? Math.round(correct / graded * 10000) / 100 : null;
   const duration = Math.max(0, Math.min(86400, int(p.durationSeconds)));
   const now = new Date().toISOString();
   const { error } = await accountMatches(db.from(attemptsTable).update({
    answers, total_questions: total, graded_questions: graded, correct_count: correct, wrong_count: wrong, blank_count: blank,
    score_percent: pct, duration_seconds: duration, status: "completed", completed_at: now, updated_at: now
   }).eq("id", attempt.id));
   if (error) throw error;
   const { error: pe } = await db.from(progressTable).upsert({
    [accountColumn]: accountId, course_id: attempt.course_id, source_year: attempt.source_year, source_file: attempt.source_file,
    attempt_id: attempt.id, current_index: Math.max(0, ids.length - 1), answers, checked_question_ids: ids,
    status: "completed", updated_at: now
   }, { onConflict: progressConflict });
   if (pe) throw pe;
   return json({ saved: true, scorePercent: pct });
  }
  throw fail("العملية غير معروفة.", 404);
 } catch (error: any) {
  return json({ error: String(error?.message || "تعذر إكمال الطلب.") }, error?.status || 400);
 }
});