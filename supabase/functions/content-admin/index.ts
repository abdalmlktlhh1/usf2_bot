import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "https://app8964547541.tgcloud.ai", "Access-Control-Allow-Headers": "content-type,authorization,apikey,x-content-sync-secret", "Access-Control-Allow-Methods": "POST,OPTIONS" },
});
const bad = (message: string, code = "BAD_REQUEST", status = 400) => Object.assign(new Error(message), { code, status });

let internalSecretHashPromise: Promise<string | null> | null = null;
async function expectedInternalSecretHash(): Promise<string | null> {
  if (!internalSecretHashPromise) {
    internalSecretHashPromise = supabase
      .from("internal_service_secret_hashes")
      .select("secret_sha256")
      .eq("secret_name", "content-admin")
      .maybeSingle()
      .then(({data, error}) => {
        if (error) {
          internalSecretHashPromise = null;
          throw error;
        }
        const value = typeof data?.secret_sha256 === "string" ? data.secret_sha256.trim().toLowerCase() : "";
        return /^[a-f0-9]{64}$/.test(value) ? value : null;
      });
  }
  return await internalSecretHashPromise;
}
async function isInternalRequest(req: Request): Promise<boolean> {
  const supplied = req.headers.get("x-content-sync-secret");
  if (!supplied || supplied.length > 256) return false;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied));
  const digest = Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
  const expected = await expectedInternalSecretHash();
  if (!expected || digest.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < digest.length; i++) difference |= digest.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
const mapLevel = (r: any) => ({ id:Number(r.id), name:r.name, description:r.description, sortOrder:r.sort_order, isActive:r.is_active, createdAt:r.created_at, updatedAt:r.updated_at });
const mapSubject = (r: any) => ({ id:Number(r.id), levelId:Number(r.level_id), name:r.name, description:r.description, sortOrder:r.sort_order, isActive:r.is_active, createdAt:r.created_at, updatedAt:r.updated_at });
const mapCourse = (r: any) => ({ id:Number(r.id), subjectId:Number(r.subject_id), name:r.name, description:r.description, durationMinutes:r.duration_minutes, passingScore:r.passing_score, sortOrder:r.sort_order, isActive:r.is_active, createdAt:r.created_at, updatedAt:r.updated_at });
const mapQuestion = (r: any) => ({ id:Number(r.id), courseId:Number(r.course_id), sourceQuestionId:r.source_question_id, questionText:r.question_text, options:r.options, correctIndex:r.correct_index, explanation:r.explanation, difficulty:r.difficulty, sourceQuestionNumber:r.source_question_number, sourceYear:r.source_year, sourceFile:r.source_file, sourceIndex:r.source_index, reviewFlags:r.review_flags, reviewStatus:r.review_status, sortOrder:r.sort_order, isActive:r.is_active, createdBy:r.created_by, createdAt:r.created_at, updatedAt:r.updated_at });
function has(auth:any, permission:string) { return !!auth?.isOwner || auth?.permissions?.includes("*") || auth?.permissions?.includes(permission); }
function globalScope(auth:any) { return !!auth?.isOwner || auth?.scopeCourseIds?.includes("*"); }
function courseScope(auth:any, id:number) { return !!auth?.isOwner || auth?.scopeCourseIds?.includes("*") || auth?.scopeCourseIds?.map(Number).includes(Number(id)); }
function requirePermission(auth:any, permission:string) { if (!has(auth, permission)) throw bad("لا تملك الصلاحية اللازمة لهذه العملية.", "FORBIDDEN", 403); }
function requireFeature(auth:any, featureKey:string) {
  if (!auth?.isOwner && auth?.featureFlags?.[featureKey] !== true) {
    throw bad("لم يفعّل المدير الرئيسي هذه الميزة لحسابك.", "FEATURE_DISABLED", 403);
  }
}
function requireGlobal(auth:any) { if (!globalScope(auth)) throw bad("هذه العملية تتطلب نطاق إدارة جميع المقررات.", "SCOPE_FORBIDDEN", 403); }
function requireCourse(auth:any, id:number) { if (!courseScope(auth,id)) throw bad("هذا المقرر خارج نطاق صلاحياتك.", "SCOPE_FORBIDDEN", 403); }
function positive(value:any, label:string) { const n=Number(value); if(!Number.isSafeInteger(n)||n<=0) throw bad(label+" غير صالح."); return n; }
function clean(value:any,label:string,max:number,required=true) { const s=typeof value==="string"?value.trim():""; if(required&&!s) throw bad("حقل "+label+" مطلوب."); if(s.length>max) throw bad("حقل "+label+" طويل أكثر من المسموح."); return s; }
async function rows(table:string) {
  const out:any[]=[]; const size=1000;
  for(let start=0;;start+=size) {
    const {data,error}=await supabase.from(table).select("*").order("id",{ascending:true}).range(start,start+size-1);
    if(error) throw error;
    out.push(...(data||[]));
    if(!data || data.length<size) break;
  }
  return out;
}
async function dashboard(summaryOnly = false) {
  const [l,s,c]=await Promise.all([rows("academic_levels"),rows("academic_subjects"),rows("academic_courses")]);
  if (summaryOnly) {
    const [totalQ, activeQ] = await Promise.all([
      supabase.from("academic_questions").select("id", {count:"exact", head:true}),
      supabase.from("academic_questions").select("id", {count:"exact", head:true}).eq("is_active", true),
    ]);
    if (totalQ.error) throw totalQ.error;
    if (activeQ.error) throw activeQ.error;
    return {
      levels:l.map(mapLevel), subjects:s.map(mapSubject), courses:c.map(mapCourse),
      questions:[], questionCount:totalQ.count || 0, activeQuestionCount:activeQ.count || 0
    };
  }
  const q=await rows("academic_questions");
  return { levels:l.map(mapLevel), subjects:s.map(mapSubject), courses:c.map(mapCourse), questions:q.map(mapQuestion) };
}
async function dashboardSummary() {
  const [levels,subjects,courses,modelResult] = await Promise.all([
    rows("academic_levels"),
    rows("academic_subjects"),
    rows("academic_courses"),
    supabase.rpc("admin_question_model_counts"),
  ]);
  if (modelResult.error) throw modelResult.error;
  const models = (modelResult.data||[]).map((row:any)=>{
    const courseId=Number(row.course_id), sourceYear=Number(row.source_year)||0, sourceFile=String(row.source_file??"");
    const total=Number(row.total_count)||0, activeCount=Number(row.active_count)||0;
    return {id:encodeURIComponent(JSON.stringify([courseId,sourceYear,sourceFile])),courseId,sourceYear,sourceFile,total,activeCount,isActive:activeCount>0};
  });
  return {
    levels:levels.map(mapLevel),subjects:subjects.map(mapSubject),courses:courses.map(mapCourse),
    questions:[],questionCount:models.reduce((sum:any,row:any)=>sum+row.total,0),
    activeQuestionCount:models.reduce((sum:any,row:any)=>sum+row.activeCount,0),models,
  };
}

async function questionsPage(auth:any,p:any) {
  const canRead = ["questions.read","questions.write","questions.publish","questions.delete"].some((permission:string)=>has(auth,permission));
  if (!canRead) throw bad("لا تملك صلاحية عرض الأسئلة.", "FORBIDDEN", 403);

  const isGlobal = globalScope(auth);
  const allowedIds = Array.isArray(auth?.scopeCourseIds)
    ? [...new Set(auth.scopeCourseIds.map(Number).filter((id:number)=>Number.isSafeInteger(id)&&id>0))]
    : [];
  if (!isGlobal && allowedIds.length === 0) return {questions:[],total:0,page:1,pageSize:25,pageCount:1};

  const queryText = typeof p.query === "string" ? p.query.trim().toLocaleLowerCase("ar").slice(0,250) : "";
  const model = p.model && typeof p.model === "object" ? p.model : null;
  const pageSize = Math.max(1, Math.min(25, Number.isSafeInteger(Number(p.pageSize)) ? Number(p.pageSize) : 25));
  const requestedPage = Math.max(1, Number.isSafeInteger(Number(p.page)) ? Number(p.page) : 1);

  let base = () => {
    let q = supabase.from("academic_questions").select("*", {count:"exact"}).order("id",{ascending:true});
    if (!isGlobal) q = q.in("course_id",allowedIds);
    if (p.reviewOnly === true) q = q.not("review_status","is",null).neq("review_status","approved");
    if (model) {
      const courseId = Number(model.courseId);
      if (!Number.isSafeInteger(courseId)||courseId<=0) throw bad("المقرر المحدد غير صالح.");
      if (!isGlobal && !allowedIds.includes(courseId)) throw bad("هذا المقرر خارج نطاق صلاحياتك.","SCOPE_FORBIDDEN",403);
      q = q.eq("course_id",courseId)
        .eq("source_year",Number.isInteger(Number(model.sourceYear))?Number(model.sourceYear):0)
        .eq("source_file",clean(model.sourceFile || "بلا اسم","اسم النموذج",500));
    }
    return q;
  };

  if (queryText) {
    const escaped = queryText.replace(/\\/g,"\\\\").replace(/"/g,'\\"').replace(/%/g,"\\%").replace(/_/g,"\\_");
    const pattern = '"%' + escaped + '%"';
    const clauses = ["question_text.ilike."+pattern, "source_file.ilike."+pattern];
    if (/^\\d{4}$/.test(queryText)) clauses.push("source_year.eq."+String(Number(queryText)));

    let coursesQuery = supabase.from("academic_courses").select("id,name");
    if (!isGlobal) coursesQuery = coursesQuery.in("id",allowedIds);
    const {data:courses,error:coursesError} = await coursesQuery;
    if (coursesError) throw coursesError;
    const matchingCourseIds = (courses||[])
      .filter((course:any)=>String(course.name||"").toLocaleLowerCase("ar").includes(queryText))
      .map((course:any)=>Number(course.id))
      .filter((id:number)=>Number.isSafeInteger(id)&&id>0);
    if (matchingCourseIds.length) clauses.push("course_id.in.("+matchingCourseIds.join(",")+")");
    base = (() => {
      let q = supabase.from("academic_questions").select("*",{count:"exact"}).order("id",{ascending:true});
      if (!isGlobal) q = q.in("course_id",allowedIds);
      if (p.reviewOnly === true) q = q.not("review_status","is",null).neq("review_status","approved");
      if (model) {
        const courseId=Number(model.courseId);
        if(!Number.isSafeInteger(courseId)||courseId<=0) throw bad("المقرر المحدد غير صالح.");
        if(!isGlobal&&!allowedIds.includes(courseId)) throw bad("هذا المقرر خارج نطاق صلاحياتك.","SCOPE_FORBIDDEN",403);
        q=q.eq("course_id",courseId)
          .eq("source_year",Number.isInteger(Number(model.sourceYear))?Number(model.sourceYear):0)
          .eq("source_file",clean(model.sourceFile||"بلا اسم","اسم النموذج",500));
      }
      return q.or(clauses.join(","));
    });
  }

  let fetched = await base().range((requestedPage-1)*pageSize, requestedPage*pageSize-1);
  if (fetched.error) throw fetched.error;
  const total = Number(fetched.count || 0);
  const pageCount = Math.max(1,Math.ceil(total/pageSize));
  const page = Math.max(1,Math.min(requestedPage,pageCount));
  if (page !== requestedPage) {
    fetched = await base().range((page-1)*pageSize,page*pageSize-1);
    if (fetched.error) throw fetched.error;
  }
  const questions = (fetched.data||[]).map(mapQuestion).map((q:any)=>({
    id:q.id,courseId:q.courseId,questionText:q.questionText,options:q.options,
    correctIndex:q.correctIndex,explanation:q.explanation,difficulty:q.difficulty,
    sourceYear:q.sourceYear,sourceFile:q.sourceFile,sortOrder:q.sortOrder,isActive:q.isActive,
    reviewStatus:q.reviewStatus,reviewFlags:q.reviewFlags||[],
  }));
  return {questions,total,page,pageSize,pageCount};
}

async function saveLevel(auth:any,p:any) {
  requirePermission(auth,"levels.write"); requireGlobal(auth);
  const name=clean(p.name,"اسم المستوى",100), description=clean(p.description,"الوصف",500,false);
  const sortOrder=Number.isSafeInteger(Number(p.sortOrder))?Number(p.sortOrder):0;
  const data={name,description,sort_order:sortOrder,updated_at:new Date().toISOString()};
  let result;
  if(p.id) { const id=positive(p.id,"المستوى"); const {data:row,error}=await supabase.from("academic_levels").update(data).eq("id",id).select("*").maybeSingle(); if(error) throw error; if(!row) throw bad("المستوى غير موجود.","NOT_FOUND",404); result=row; }
  else { const {data:row,error}=await supabase.from("academic_levels").insert({...data,is_active:true}).select("*").single(); if(error) throw error; result=row; }
  return {saved:mapLevel(result)};
}
async function setLevelActive(auth:any,p:any) {
  requirePermission(auth,"levels.write"); requireGlobal(auth); const id=positive(p.id,"المستوى");
  const {data,error}=await supabase.from("academic_levels").update({is_active:p.isActive===true,updated_at:new Date().toISOString()}).eq("id",id).select("id,is_active").maybeSingle();
  if(error) throw error; if(!data) throw bad("المستوى غير موجود.","NOT_FOUND",404); return {id:Number(data.id),isActive:data.is_active};
}
async function saveSubject(auth:any,p:any) {
  requirePermission(auth,"subjects.write"); requireGlobal(auth);
  const levelId=positive(p.levelId,"المستوى"); const level=await supabase.from("academic_levels").select("id").eq("id",levelId).maybeSingle();
  if(level.error) throw level.error; if(!level.data) throw bad("المستوى المحدد غير موجود.","NOT_FOUND",404);
  const name=clean(p.name,"اسم المادة",120), description=clean(p.description,"الوصف",500,false), sortOrder=Number.isSafeInteger(Number(p.sortOrder))?Number(p.sortOrder):0;
  const data={level_id:levelId,name,description,sort_order:sortOrder,updated_at:new Date().toISOString()};
  let result;
  if(p.id){const id=positive(p.id,"المادة");const {data:row,error}=await supabase.from("academic_subjects").update(data).eq("id",id).select("*").maybeSingle();if(error)throw error;if(!row)throw bad("المادة غير موجودة.","NOT_FOUND",404);result=row;}
  else {const {data:row,error}=await supabase.from("academic_subjects").insert({...data,is_active:true}).select("*").single();if(error)throw error;result=row;}
  return {saved:mapSubject(result)};
}
async function setSubjectActive(auth:any,p:any) {
  requirePermission(auth,"subjects.write"); requireGlobal(auth); const id=positive(p.id,"المادة");
  const {data,error}=await supabase.from("academic_subjects").update({is_active:p.isActive===true,updated_at:new Date().toISOString()}).eq("id",id).select("id,is_active").maybeSingle();
  if(error)throw error;if(!data)throw bad("المادة غير موجودة.","NOT_FOUND",404);return {id:Number(data.id),isActive:data.is_active};
}
async function saveCourse(auth:any,p:any) {
  requirePermission(auth,"courses.write"); requireGlobal(auth);
  const subjectId=positive(p.subjectId,"المادة"); const subject=await supabase.from("academic_subjects").select("id").eq("id",subjectId).maybeSingle();
  if(subject.error)throw subject.error;if(!subject.data)throw bad("المادة المحددة غير موجودة.","NOT_FOUND",404);
  const name=clean(p.name,"اسم المقرر",150),description=clean(p.description,"الوصف",600,false);
  const durationMinutes=Number(p.durationMinutes??60),passingScore=Number(p.passingScore??50),sortOrder=Number.isSafeInteger(Number(p.sortOrder))?Number(p.sortOrder):0;
  if(!Number.isInteger(durationMinutes)||durationMinutes<1||durationMinutes>300)throw bad("مدة الاختبار يجب أن تكون بين دقيقة واحدة و300 دقيقة.");
  if(!Number.isInteger(passingScore)||passingScore<0||passingScore>100)throw bad("درجة النجاح يجب أن تكون بين 0 و100.");
  const data={subject_id:subjectId,name,description,duration_minutes:durationMinutes,passing_score:passingScore,sort_order:sortOrder,updated_at:new Date().toISOString()};
  let result;
  if(p.id){const id=positive(p.id,"المقرر");const {data:row,error}=await supabase.from("academic_courses").update(data).eq("id",id).select("*").maybeSingle();if(error)throw error;if(!row)throw bad("المقرر غير موجود.","NOT_FOUND",404);result=row;}
  else {const {data:row,error}=await supabase.from("academic_courses").insert({...data,is_active:true}).select("*").single();if(error)throw error;result=row;}
  return {saved:mapCourse(result)};
}
async function setCourseActive(auth:any,p:any) {
  requirePermission(auth,"courses.write"); requireGlobal(auth); const id=positive(p.id,"المقرر");
  const {data,error}=await supabase.from("academic_courses").update({is_active:p.isActive===true,updated_at:new Date().toISOString()}).eq("id",id).select("id,is_active").maybeSingle();
  if(error)throw error;if(!data)throw bad("المقرر غير موجود.","NOT_FOUND",404);return {id:Number(data.id),isActive:data.is_active};
}
async function saveQuestion(auth:any,p:any,approvedByReviewer=false) {
  requirePermission(auth,approvedByReviewer?"questions.publish":"questions.write");
  const courseId=positive(p.courseId,"المقرر"); requireCourse(auth,courseId);
  const {data:course,error:courseError}=await supabase.from("academic_courses").select("id").eq("id",courseId).maybeSingle();
  if(courseError)throw courseError;if(!course)throw bad("المقرر غير موجود.","NOT_FOUND",404);
  const questionText=clean(p.questionText,"نص السؤال",3000);
  const options=Array.isArray(p.options)?p.options.map((v:any)=>typeof v==="string"?v.trim():""):[];
  if(options.length<2||options.length>8||options.some((v:string)=>!v||v.length>500))throw bad("يجب أن يحتوي السؤال على خيارين إلى ثمانية خيارات، وألا يكون أي خيار فارغًا أو طويلًا جدًا.");
  const correctIndex=p.correctIndex==null||p.correctIndex===""?null:Number(p.correctIndex);
  if(correctIndex!==null&&(!Number.isInteger(correctIndex)||correctIndex<0||correctIndex>=options.length))throw bad("الإجابة الصحيحة المحددة غير صالحة.");
  const explanation=clean(p.explanation,"التوضيح",1500,false),difficulty=["easy","normal","hard"].includes(p.difficulty)?p.difficulty:"normal",sortOrder=Number.isSafeInteger(Number(p.sortOrder))?Number(p.sortOrder):0;
  const now=new Date().toISOString();
  const sourceYear=Number.isInteger(Number(p.sourceYear))?Number(p.sourceYear):new Date().getFullYear(); const sourceFile=clean(p.sourceFile||"لوحة الإدارة","اسم النموذج",500); const sourceIndex=Number.isSafeInteger(Number(p.sourceIndex))?Number(p.sourceIndex):sortOrder+1; const reviewFlags=Array.isArray(p.reviewFlags)?p.reviewFlags.filter((v:any)=>typeof v==="string").slice(0,8):[];
  const data={course_id:courseId,question_text:questionText,options,correct_index:correctIndex,explanation,difficulty,source_year:sourceYear,source_file:sourceFile,source_index:sourceIndex,sort_order:sortOrder,review_flags:reviewFlags,updated_by:Number(auth.telegramId)||0,updated_at:now};
  let result;
  if(p.id){const id=positive(p.id,"السؤال");const {data:current,error}=await supabase.from("academic_questions").select("*").eq("id",id).maybeSingle();if(error)throw error;if(!current)throw bad("السؤال غير موجود.","NOT_FOUND",404);requireCourse(auth,Number(current.course_id));const {data:row,error:saveError}=await supabase.from("academic_questions").update(data).eq("id",id).select("*").single();if(saveError)throw saveError;result=row;}
  else {const active=has(auth,"questions.publish")&&p.isActive!==false;const {data:row,error}=await supabase.from("academic_questions").insert({...data,source_question_id:"admin:"+crypto.randomUUID(),source_year:sourceYear,source_file:sourceFile,source_index:sourceIndex,review_flags:[],review_status:"approved",is_active:active,created_by:Number(auth.telegramId)}).select("*").single();if(error)throw error;result=row;}
  return {saved:mapQuestion(result)};
}
async function setQuestionCorrectAnswer(auth:any,p:any) {
  requireFeature(auth,"quizCorrection");
  requirePermission(auth,"questions.write");
  const courseId=positive(p.courseId,"المقرر");
  requireCourse(auth,courseId);
  const questionRef=clean(p.questionId,"معرّف السؤال",300);
  let query=supabase.from("academic_questions").select("id,course_id,options,source_question_id");
  if(/^db:\d+$/.test(questionRef)) query=query.eq("id",Number(questionRef.slice(3)));
  else if(/^\d+$/.test(questionRef)) query=query.eq("id",Number(questionRef));
  else query=query.eq("source_question_id",questionRef);
  const {data:current,error}=await query.maybeSingle();
  if(error)throw error;
  if(!current||Number(current.course_id)!==courseId)throw bad("السؤال غير موجود في هذا المقرر.","NOT_FOUND",404);
  const options=Array.isArray(current.options)?current.options:[];
  const correctIndex=Number(p.correctIndex);
  if(!Number.isInteger(correctIndex)||correctIndex<0||correctIndex>=options.length||!String(options[correctIndex]??"").trim())throw bad("اختر إجابة صحيحة من خيارات السؤال.");
  const actorId=Number(auth.telegramId)||0,now=new Date().toISOString();
  const {data,error:saveError}=await supabase.from("academic_questions")
    .update({correct_index:correctIndex,review_status:"approved",updated_by:actorId,updated_at:now})
    .eq("id",Number(current.id)).eq("course_id",courseId)
    .select("id,course_id,source_question_id,correct_index,updated_at").single();
  if(saveError)throw saveError;
  return {saved:true,id:Number(data.id),courseId,questionId:data.source_question_id||"db:"+data.id,correctIndex,correctAnswer:options[correctIndex],updatedAt:data.updated_at};
}
async function setQuestionActive(auth:any,p:any) {
  const id=positive(p.id,"السؤال");
  const {data:current,error}=await supabase.from("academic_questions").select("id,course_id,question_text,is_active").eq("id",id).maybeSingle();
  if(error)throw error;if(!current)throw bad("السؤال غير موجود.","NOT_FOUND",404);
  requireCourse(auth,Number(current.course_id));
  const isActive=p.isActive===true;requirePermission(auth,isActive?"questions.publish":"questions.delete");
  const {data,error:saveError}=await supabase.from("academic_questions").update({is_active:isActive,updated_by:Number(auth.telegramId)||null,updated_at:new Date().toISOString()}).eq("id",id).select("id,is_active").single();
  if(saveError)throw saveError;return {id:Number(data.id),isActive:data.is_active};
}
async function renameModel(auth:any,p:any) {
  requirePermission(auth,"questions.write");
  const courseId=positive(p.courseId,"المقرر"); requireCourse(auth,courseId);
  const oldYear=Number.isInteger(Number(p.sourceYear))?Number(p.sourceYear):0;
  const oldFile=clean(p.sourceFile,"اسم النموذج الحالي",500);
  const newYear=Number.isInteger(Number(p.newSourceYear))?Number(p.newSourceYear):oldYear;
  const newFile=clean(p.newSourceFile,"اسم النموذج الجديد",500);
  const {data,error}=await supabase.from("academic_questions").update({source_year:newYear,source_file:newFile,updated_by:Number(auth.telegramId)||null,updated_at:new Date().toISOString()})
    .eq("course_id",courseId).eq("source_year",oldYear).eq("source_file",oldFile).select("id");
  if(error)throw error;if(!data?.length)throw bad("لم يُعثر على أسئلة هذا النموذج.","NOT_FOUND",404);
  return {updated:data.length,courseId,sourceYear:newYear,sourceFile:newFile};
}
async function setModelActive(auth:any,p:any) {
  const courseId=positive(p.courseId,"المقرر"); requireCourse(auth,courseId);
  const isActive=p.isActive===true;requirePermission(auth,isActive?"questions.publish":"questions.delete");
  const sourceYear=Number.isInteger(Number(p.sourceYear))?Number(p.sourceYear):0,sourceFile=clean(p.sourceFile,"اسم النموذج",500);
  const {data,error}=await supabase.from("academic_questions").update({is_active:isActive,updated_by:Number(auth.telegramId)||null,updated_at:new Date().toISOString()})
    .eq("course_id",courseId).eq("source_year",sourceYear).eq("source_file",sourceFile).select("id");
  if(error)throw error;if(!data?.length)throw bad("لم يُعثر على أسئلة هذا النموذج.","NOT_FOUND",404);
  return {updated:data.length,courseId,sourceYear,sourceFile,isActive};
}
async function deleteModel(auth:any,p:any) {
  requirePermission(auth,"questions.delete");
  const courseId=positive(p.courseId,"المقرر");requireCourse(auth,courseId);
  const sourceYear=Number.isInteger(Number(p.sourceYear))?Number(p.sourceYear):0;
  if(sourceYear<0||sourceYear>2100) throw bad("سنة النموذج غير صالحة.");
  const sourceFile=clean(p.sourceFile,"اسم النموذج",500);

  const hasActiveRows = async (table:string) => {
    let query=supabase.from(table).select("id").eq("course_id",courseId)
      .eq("source_file",sourceFile).eq("status","in_progress").limit(1);
    query=sourceYear===0
      ? query.or("source_year.eq.0,source_year.is.null")
      : query.eq("source_year",sourceYear);
    const {data,error}=await query;
    if(error) throw error;
    return (data||[]).length>0;
  };
  const [activeAttempts,activeProgress]=await Promise.all([
    hasActiveRows("student_attempts"),
    hasActiveRows("student_progress"),
  ]);
  if(activeAttempts||activeProgress) {
    throw bad("لا يمكن حذف النموذج الآن؛ يوجد طالب لديه اختبار جارٍ منه. انتظر انتهاء المحاولة ثم أعد الحذف.","MODEL_IN_PROGRESS",409);
  }

  let questionQuery=supabase.from("academic_questions").select("id").eq("course_id",courseId).eq("source_file",sourceFile);
  questionQuery=sourceYear===0
    ? questionQuery.or("source_year.eq.0,source_year.is.null")
    : questionQuery.eq("source_year",sourceYear);
  const {data:matches,error:matchError}=await questionQuery;
  if(matchError) throw matchError;
  const questionIds=(matches||[]).map((row:any)=>Number(row.id)).filter((id:number)=>Number.isSafeInteger(id)&&id>0);
  if(!questionIds.length) throw bad("لم يُعثر على أسئلة هذا النموذج.","NOT_FOUND",404);

  let deleteQuery=supabase.from("academic_questions").delete().eq("course_id",courseId).eq("source_file",sourceFile);
  deleteQuery=sourceYear===0
    ? deleteQuery.or("source_year.eq.0,source_year.is.null")
    : deleteQuery.eq("source_year",sourceYear);
  const {data:deleted,error:deleteError}=await deleteQuery.select("id");
  if(deleteError) throw deleteError;
  const deletedCount=(deleted||[]).length;
  if(deletedCount!==questionIds.length) {
    throw bad("لم يكتمل حذف جميع أسئلة النموذج؛ راجع قائمة النماذج قبل إعادة المحاولة.","MODEL_DELETE_PARTIAL",409);
  }
  return {deleted:true,deletedQuestions:deletedCount,courseId,sourceYear,sourceFile,attemptsPreserved:true};
}

async function approveQuestionChange(auth:any,p:any) {
  requirePermission(auth,"questions.publish");
  const payload=p.question&&typeof p.question==="object"?p.question:{};
  const courseId=positive(payload.courseId,"المقرر");requireCourse(auth,courseId);
  if(payload.id) {
    const id=positive(payload.id,"السؤال");
    const {data:current,error}=await supabase.from("academic_questions").select("id,course_id").eq("id",id).maybeSingle();
    if(error)throw error;if(!current)throw bad("السؤال المراد تعديله لم يعد موجودًا.","NOT_FOUND",404);requireCourse(auth,Number(current.course_id));
  }
  const approvedPayload={...payload,isActive:payload.id?payload.isActive:true};
  return await saveQuestion(auth,approvedPayload,true);
}
async function analyzeModelJson(auth:any,p:any) {
  requireFeature(auth,"assistant");
  requirePermission(auth,"questions.write");
  const questions=Array.isArray(p.questions)?p.questions:[];
  if(!questions.length||questions.length>500)throw bad("عدد الأسئلة يجب أن يكون من 1 إلى 500.");
  const apiKey=Deno.env.get("GEMINI_API_KEY");
  if(!apiKey)throw bad("مفتاح المساعد الذكي غير مضبوط على الخادم.","AI_NOT_CONFIGURED",503);
  const normalized=questions.map((raw:any,index:number)=>{
    if(!raw||typeof raw!=="object"||Array.isArray(raw))throw bad("بيانات السؤال رقم "+(index+1)+" غير صالحة.");
    const questionText=clean(raw.questionText??raw.question??raw.text,"نص السؤال "+(index+1),3000);
    const rawOptions=raw.options??raw.choices;
    if(!Array.isArray(rawOptions)||rawOptions.length<2||rawOptions.length>8)throw bad("خيارات السؤال رقم "+(index+1)+" غير صالحة.");
    const options=rawOptions.map((v:any)=>typeof v==="string"?v.trim():String(v?.text??v?.label??v?.value??"").trim());
    if(options.some((v:string)=>!v||v.length>500))throw bad("يوجد خيار فارغ أو طويل في السؤال رقم "+(index+1)+".");
    const rawAnswer=raw.correctIndex??raw.correctAnswer??raw.answerIndex??raw.answer;
    let correctIndex:any=null;
    if(rawAnswer!==undefined&&rawAnswer!==null&&rawAnswer!==""){
      correctIndex=typeof rawAnswer==="string"&&!/^\d+$/.test(rawAnswer)?options.findIndex((v:string)=>v===rawAnswer.trim()):Number(rawAnswer);
      if(!Number.isInteger(correctIndex)||correctIndex<0||correctIndex>=options.length)correctIndex=null;
    }
    return {questionText,options,correctIndex,explanation:String(raw.explanation??raw.explain??"").slice(0,1500),difficulty:["easy","normal","hard"].includes(raw.difficulty)?raw.difficulty:"normal"};
  });
  const prompt="صنّف أسئلة اختيار من متعدد في مقرر جامعي قانوني. أعد كائن JSON فقط بالشكل {\"classifications\":[{\"index\":1,\"classification\":\"موضوع قصير بالعربية\"}]}. أعد تصنيفًا موضوعيًا قصيرًا لكل سؤال وفق نصه وخياراته، ولا تكتب إجابات ولا تغيّر أي سؤال أو خيار. ستتم المحافظة على نصوص الأسئلة والخيارات ومفاتيح الإجابة من المصدر خارج النموذج. إذا لم يتضح الموضوع فاكتب \"غير مصنف\".\n\n"+JSON.stringify(normalized.map((q:any,i:number)=>({index:i+1,question:q.questionText,options:q.options})));
  const model=(Deno.env.get("GEMINI_MODEL")||"gemini-3.8-flash").trim();
  let response:Response;
  try{
    response=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent?key="+encodeURIComponent(apiKey),{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",temperature:0.1,maxOutputTokens:Math.min(12000,Math.max(1000,questions.length*24))}})
    });
  }catch{throw bad("تعذر الاتصال بخدمة المساعد الذكي.","AI_UNAVAILABLE",503);}
  if(!response.ok)throw bad("تعذر تحليل النموذج بالذكاء الاصطناعي. تحقق من إعدادات الخدمة ثم أعد المحاولة.","AI_REQUEST_FAILED",502);
  const payload=await response.json().catch(()=>({}));
  const output=(payload?.candidates?.[0]?.content?.parts||[]).map((part:any)=>part.text||"").join("").trim();
  let parsed:any;
  try{parsed=JSON.parse(output.replace(/^\uFEFF/,"").replace(/^\s*\x60{3}(?:json)?\s*/i,"").replace(/\s*\x60{3}\s*$/,""));}catch{throw bad("أعاد المساعد الذكي تنسيقًا غير صالح؛ لم تُحفظ أي أسئلة.","AI_INVALID_RESULT",502);}
  const classified=Array.isArray(parsed?.classifications)?parsed.classifications:[];
  const byIndex=new Map<number,string>();
  for(const item of classified){const ix=Number(item?.index);const label=typeof item?.classification==="string"?item.classification.trim().slice(0,160):"";if(Number.isInteger(ix)&&ix>=1&&ix<=normalized.length&&label)byIndex.set(ix,label);}
  return {questions:normalized.map((q:any,i:number)=>({...q,classification:byIndex.get(i+1)||"غير مصنف"})),classifiedCount:byIndex.size,model};
}
async function importModelJson(auth:any,p:any) {
  requireFeature(auth,"modelImport");
  requirePermission(auth,"questions.write");
  requirePermission(auth,"questions.publish");
  const courseId=positive(p.courseId,"المقرر");
  requireCourse(auth,courseId);
  const sourceYear=Number(p.sourceYear);
  if(!Number.isSafeInteger(sourceYear)||sourceYear<0||sourceYear>2100) throw bad("سنة النموذج غير صالحة.");
  const sourceSystem=clean(p.sourceSystem,"النظام الدراسي",80);
  const sourceAudience=clean(p.sourceAudience,"الفئة المستهدفة",20);
  if(!["طلاب","طالبات"].includes(sourceAudience)) throw bad("الفئة المستهدفة يجب أن تكون طلابًا أو طالبات.");
  const modelName=clean(p.sourceFile,"اسم النموذج",400);
  const sourceFile="⟦نظام:"+sourceSystem.replace(/[⟦⟧]/g,"")+"⟧⟦الفئة:"+sourceAudience+"⟧ "+modelName;
  if(sourceFile.length>500) throw bad("اسم النموذج مع النظام والفئة أطول من المسموح.");
  if(!Array.isArray(p.questions)||p.questions.length<1||p.questions.length>500) throw bad("عدد الأسئلة يجب أن يكون من 1 إلى 500.");
  let sourceQuestions=p.questions;
  if(p.useAI===true){
    requireFeature(auth,"assistant");
    const aiResult=await analyzeModelJson(auth,{questions:sourceQuestions});
    sourceQuestions=aiResult.questions;
  }
  const actorId=Number(auth.telegramId);
  if(!Number.isSafeInteger(actorId)||actorId<=0) throw bad("تعذر تحديد حساب المدير الذي يجري الاستيراد.");
  const {data:course,error:courseError}=await supabase.from("academic_courses").select("id,subject_id,is_active").eq("id",courseId).maybeSingle();
  if(courseError) throw courseError;
  if(!course) throw bad("المقرر غير موجود.","NOT_FOUND",404);
  if(course.is_active===false) throw bad("لا يمكن الاستيراد إلى مقرر مؤرشف.","COURSE_ARCHIVED");
  const {data:subject,error:subjectError}=await supabase.from("academic_subjects").select("id,level_id,is_active").eq("id",Number(course.subject_id)).maybeSingle();
  if(subjectError) throw subjectError;
  if(!subject||subject.is_active===false) throw bad("المادة التابعة للمقرر غير متاحة.","SUBJECT_UNAVAILABLE");
  if(p.levelId!=null && Number(subject.level_id)!==positive(p.levelId,"المستوى")) throw bad("المقرر لا يتبع المستوى المحدد.","COURSE_LEVEL_MISMATCH");
  const {count:existingCount,error:existingError}=await supabase.from("academic_questions")
    .select("id",{count:"exact",head:true}).eq("course_id",courseId).eq("source_year",sourceYear).eq("source_file",sourceFile);
  if(existingError) throw existingError;
  if(Number(existingCount||0)>0) {
    if(Number(existingCount)===p.questions.length) return {imported:0,skipped:true,existing:Number(existingCount),courseId,sourceYear,sourceFile};
    throw bad("يوجد نموذج بالاسم نفسه يحتوي عددًا مختلفًا من الأسئلة؛ أوقفت الاستيراد لتجنب تكرار أو خلط البيانات.","MODEL_EXISTS");
  }
  const rows=sourceQuestions.map((raw:any,index:number)=>{
    if(!raw||typeof raw!=="object"||Array.isArray(raw)) throw bad("بيانات السؤال رقم "+(index+1)+" غير صالحة.");
    const questionText=clean(raw.questionText??raw.question??raw.text,"نص السؤال "+(index+1),3000);
    const rawOptions=raw.options??raw.choices;
    if(!Array.isArray(rawOptions)) throw bad("خيارات السؤال رقم "+(index+1)+" يجب أن تكون مصفوفة.");
    const options=rawOptions.map((v:any)=>typeof v==="string"?v.trim():String(v?.text??v?.label??v?.value??"").trim());
    if(options.length<2||options.length>8||options.some((v:string)=>!v||v.length>500)) throw bad("السؤال رقم "+(index+1)+" يجب أن يحتوي من خيارين إلى 8 خيارات غير فارغة.");
    const rawAnswer=raw.correctIndex??raw.correctAnswer??raw.answerIndex??raw.answer;
    const correctIndex=rawAnswer==null||rawAnswer===""?null:(typeof rawAnswer==="string"&&!/^\d+$/.test(rawAnswer)
      ? options.findIndex((v:string)=>v===rawAnswer.trim()) : Number(rawAnswer));
    if(correctIndex!==null&&(!Number.isInteger(correctIndex)||correctIndex<0||correctIndex>=options.length)) throw bad("الإجابة الصحيحة للسؤال رقم "+(index+1)+" غير صالحة.");
    return {
      course_id:courseId,
      source_question_id:"admin:"+crypto.randomUUID(),
      question_text:questionText,
      options,
      correct_index:correctIndex,
      explanation:String(raw.explanation??raw.explain??"").slice(0,1500),
      difficulty:["easy","normal","hard"].includes(raw.difficulty)?raw.difficulty:"normal",
      source_question_number:index+1,
      source_year:sourceYear,
      source_file:sourceFile,
      source_index:index+1,
      review_flags:typeof raw.classification==="string"&&raw.classification.trim()?["تصنيف مقترح بالذكاء الاصطناعي: "+raw.classification.trim().slice(0,160)]:[],
      review_status:"approved",
      sort_order:index+1,
      is_active:true,
      created_by:actorId,
      updated_by:actorId,
    };
  });
  const inserted:any[]=[];
  for(let start=0;start<rows.length;start+=100){
    const {data,error}=await supabase.from("academic_questions").insert(rows.slice(start,start+100)).select("id");
    if(error)throw error;
    inserted.push(...(data||[]));
  }
  return {imported:inserted.length||rows.length,skipped:false,courseId,sourceYear,sourceFile,awaitingAnswer:rows.filter((row:any)=>row.correct_index===null).length};
}

async function questionHistory(auth:any) {
  requirePermission(auth,"questions.read");
  const {data,error}=await supabase.from("academic_question_revisions")
    .select("id,question_id,course_id,change_type,before_snapshot,after_snapshot,changed_by,created_at")
    .order("created_at",{ascending:false}).limit(500);
  if(error)throw error;
  const rows=data||[];
  return {revisions:rows.filter((row:any)=>courseScope(auth,Number(row.course_id)))};
}


async function listStudents(auth:any) {
  requirePermission(auth, "students.read");
  const {data,error}=await supabase.from("app_student_profiles")
    .select("user_id,username,display_name,level_id,approval_status,role,created_at,last_telegram_login_at,telegram_id,academic_levels(name)")
    .eq("role","student").order("created_at",{ascending:false}).limit(500);
  if(error)throw error;
  return {students:(data||[]).map((row:any)=>({
    userId:row.user_id,
    username:row.username,
    displayName:row.display_name,
    levelId:row.level_id,
    levelName:Array.isArray(row.academic_levels)?row.academic_levels[0]?.name:row.academic_levels?.name,
    approvalStatus:row.approval_status,
    createdAt:row.created_at,
    lastTelegramLoginAt:row.last_telegram_login_at,
    telegramLinked:row.telegram_id!=null,
  }))};
}

async function moveStudentLevel(auth:any,p:any) {
  if(!auth?.isOwner) throw bad("نقل الطلاب بين المستويات متاح للمدير الرئيسي فقط.","FORBIDDEN",403);
  const userId=clean(p.userId,"معرّف الحساب",64);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) throw bad("معرّف حساب الطالب غير صالح.");
  const levelId=Number(p.levelId);
  if(!Number.isSafeInteger(levelId)||levelId<=0) throw bad("المستوى المطلوب غير صالح.");
  const {data:target,error:targetError}=await supabase.from("app_student_profiles").select("user_id,username,display_name,role,level_id").eq("user_id",userId).maybeSingle();
  if(targetError) throw targetError;
  if(!target||target.role!=="student") throw bad("حساب الطالب غير موجود.","NOT_FOUND",404);
  const {data:level,error:levelError}=await supabase.from("academic_levels").select("id,name").eq("id",levelId).eq("is_active",true).maybeSingle();
  if(levelError) throw levelError; if(!level) throw bad("المستوى المطلوب غير متاح.");
  if(Number(target.level_id)===levelId) return {ok:true,unchanged:true,userId,levelId,levelName:level.name};
  const {data,error}=await supabase.from("app_student_profiles").update({level_id:levelId,updated_at:new Date().toISOString()}).eq("user_id",userId).eq("role","student").select("user_id,username,display_name,level_id").single();
  if(error) throw error;
  const {error:cancelError}=await supabase.from("student_level_transfer_requests")
    .update({status:"cancelled",review_note:"أُلغي الطلب بسبب نقل الطالب مباشرة من الإدارة.",reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()})
    .eq("user_id",userId).eq("status","pending");
  if(cancelError) throw cancelError;
  return {ok:true,userId:data.user_id,username:data.username,displayName:data.display_name,levelId:Number(data.level_id),levelName:level.name,previousLevelId:Number(target.level_id)};
}

async function listStudentLevelRequests(auth:any) {
  if(!auth?.isOwner) throw bad("عرض طلبات النقل متاح للمدير الرئيسي فقط.","FORBIDDEN",403);
  const {data:requests,error}=await supabase.from("student_level_transfer_requests")
    .select("id,user_id,current_level_id,requested_level_id,reason,status,review_note,created_at,reviewed_at,reviewed_by")
    .order("created_at",{ascending:false}).limit(500);
  if(error) throw error;
  const userIds=[...new Set((requests||[]).map((r:any)=>r.user_id))];
  const levelIds=[...new Set((requests||[]).flatMap((r:any)=>[r.current_level_id,r.requested_level_id]).filter(Boolean).map(Number))];
  const [{data:students,error:studentsError},{data:levels,error:levelsError}]=await Promise.all([
    userIds.length?supabase.from("app_student_profiles").select("user_id,username,display_name,telegram_id").in("user_id",userIds):Promise.resolve({data:[],error:null}),
    levelIds.length?supabase.from("academic_levels").select("id,name").in("id",levelIds):Promise.resolve({data:[],error:null})
  ]);
  if(studentsError) throw studentsError; if(levelsError) throw levelsError;
  const studentMap=new Map((students||[]).map((r:any)=>[r.user_id,r]));
  const levelMap=new Map((levels||[]).map((r:any)=>[Number(r.id),r.name]));
  return {requests:(requests||[]).map((r:any)=>{const student:any=studentMap.get(r.user_id)||{};return {...r,studentName:student.display_name||student.username||"طالب",username:student.username||"",telegramId:student.telegram_id, currentLevelName:levelMap.get(Number(r.current_level_id))||"غير محدد",requestedLevelName:levelMap.get(Number(r.requested_level_id))||"غير معروف"};})};
}

async function reviewStudentLevelRequest(auth:any,p:any) {
  if(!auth?.isOwner) throw bad("مراجعة طلبات النقل متاحة للمدير الرئيسي فقط.","FORBIDDEN",403);
  const requestId=clean(p.requestId,"طلب النقل",64);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) throw bad("معرّف طلب النقل غير صالح.");
  const status=String(p.status||"");
  if(!["approved","rejected"].includes(status)) throw bad("قرار المراجعة غير صالح.");
  const {data,error}=await supabase.rpc("review_student_level_transfer",{
    p_request_id:requestId,
    p_status:status,
    p_reviewed_by:auth.userId||null,
    p_review_note:clean(p.reviewNote||"","ملاحظة المراجعة",500,false)
  });
  if(error) throw error;
  return {ok:true,request:data};
}

async function setStudentStatus(auth:any,p:any) {
  if(!auth?.isOwner)throw bad("إيقاف حسابات الطلاب متاح للمدير الرئيسي فقط.","FORBIDDEN",403);
  const userId=clean(p.userId,"معرّف الحساب",64);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId))
    throw bad("معرّف الحساب غير صالح.");
  const status=String(p.status||"");
  if(!["approved","suspended"].includes(status))throw bad("حالة الحساب غير صالحة.");
  const {data:target,error:targetError}=await supabase.from("app_student_profiles")
    .select("user_id,username,role").eq("user_id",userId).maybeSingle();
  if(targetError)throw targetError;
  if(!target||target.role!=="student")throw bad("حساب الطالب غير موجود أو لا يمكن إيقافه.","NOT_FOUND",404);
  const {data,error}=await supabase.from("app_student_profiles")
    .update({approval_status:status,updated_at:new Date().toISOString()})
    .eq("user_id",userId).eq("role","student")
    .select("user_id,username,approval_status").single();
  if(error)throw error;
  return {ok:true,userId:data.user_id,username:data.username,status:data.approval_status};
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ok:true});
  if (req.method !== "POST") return json({error:"Method not allowed"},405);
  let internalAuthorized = false;
  try {
    internalAuthorized = await isInternalRequest(req);
  } catch {
    return json({error:"تعذر التحقق من صلاحية الاتصال."},503);
  }
  let browserAdminProfile:any=null;
  if (!internalAuthorized) {
    const token=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");
    if (!token) return json({error:"سجّل الدخول بحساب المدير من المتصفح."},401);
    const {data:{user},error:authError}=await supabase.auth.getUser(token);
    if (authError || !user) return json({error:"انتهت جلسة الدخول؛ سجّل الدخول مجددًا."},401);
    const {data:profile,error:profileError}=await supabase.from("app_student_profiles")
      .select("user_id,username,display_name,role,approval_status")
      .eq("user_id",user.id).maybeSingle();
    if (profileError || !profile || profile.role!=="admin" || ["suspended","blocked"].includes(String(profile.approval_status))) {
      return json({error:"هذه اللوحة مخصصة لحساب المدير المصرّح به."},403);
    }
    browserAdminProfile=profile;
  }
  try {
    const body=await req.json(), action=String(body.action||""), p=body.payload||{};
    const auth=browserAdminProfile
      ? {isOwner:true,permissions:["*"],scopeCourseIds:["*"]}
      : (body.auth||{});
    let result:any;
    if(action==="dashboard") {
      if(!auth.isOwner && !["levels.read","levels.write","subjects.read","subjects.write","courses.read","courses.write","questions.read","questions.write","questions.publish","questions.delete","statistics.read","audit.read"].some((x:string)=>has(auth,x))) throw bad("غير مصرح.","FORBIDDEN",403);
      if (browserAdminProfile) {
        result=await dashboardSummary();
        result.user={isOwner:false,username:browserAdminProfile.username,displayName:browserAdminProfile.display_name||browserAdminProfile.username};
        result.permissions=["levels.read","levels.write","subjects.read","subjects.write","courses.read","courses.write","questions.read","questions.write","questions.publish","questions.delete","students.read","students.manage"];
        result.canManageCatalog=true;
        result.canManageModerators=false;
        result.allCoursesCount=(result.courses||[]).length;
        result.browserAdmin=true;
      } else {
        result=await dashboard(p.summaryOnly === true);
      }
    } else if(action==="dashboardSummary") {
      if(!auth.isOwner && !["levels.read","levels.write","subjects.read","subjects.write","courses.read","courses.write","questions.read","questions.write","questions.publish","questions.delete","statistics.read","audit.read"].some((x:string)=>has(auth,x))) throw bad("غير مصرح.","FORBIDDEN",403);
      result=await dashboardSummary();
    } else if(action==="questionsPage") result=await questionsPage(auth,p);
    else if(action==="listStudents") result=await listStudents(auth);
    else if(action==="setStudentStatus") result=await setStudentStatus(auth,p);
    else if(action==="moveStudentLevel") result=await moveStudentLevel(auth,p);
    else if(action==="listStudentLevelRequests") result=await listStudentLevelRequests(auth);
    else if(action==="reviewStudentLevelRequest") result=await reviewStudentLevelRequest(auth,p);
    else if(action==="saveLevel") result=await saveLevel(auth,p);
    else if(action==="setLevelActive") result=await setLevelActive(auth,p);
    else if(action==="saveSubject") result=await saveSubject(auth,p);
    else if(action==="setSubjectActive") result=await setSubjectActive(auth,p);
    else if(action==="saveCourse") result=await saveCourse(auth,p);
    else if(action==="setCourseActive") result=await setCourseActive(auth,p);
    else if(action==="saveQuestion") result=await saveQuestion(auth,p);
    else if(action==="setQuestionCorrectAnswer") result=await setQuestionCorrectAnswer(auth,p);
    else if(action==="analyzeModelJson") result=await analyzeModelJson(auth,p);
    else if(action==="importModelJson") result=await importModelJson(auth,p);
    else if(action==="approveQuestionChange") result=await approveQuestionChange(auth,p);
    else if(action==="questionHistory") result=await questionHistory(auth);
    else if(action==="setQuestionActive") result=await setQuestionActive(auth,p);
    else if(action==="renameModel") result=await renameModel(auth,p);
    else if(action==="setModelActive") result=await setModelActive(auth,p);
    else if(action==="deleteModel") result=await deleteModel(auth,p);
    else throw bad("العملية المطلوبة غير معروفة.","UNKNOWN_ACTION",404);
    return json(result);
  } catch(e:any) {
    const code=e?.code||"SUPABASE_ERROR";
    const status=e?.status||(/duplicate key|unique constraint/i.test(e?.message||"")?409:400);
    const message=/duplicate key|unique constraint/i.test(e?.message||"")?"يوجد سجل بهذا الاسم بالفعل.":(e?.message||"تعذر تنفيذ العملية.");
    return json({error:message,code},status);
  }
});
