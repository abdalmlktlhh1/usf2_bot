import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "https://app8964547541.tgcloud.ai", "Access-Control-Allow-Headers": "content-type,x-content-sync-secret", "Access-Control-Allow-Methods": "POST,OPTIONS" },
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
  const correctIndex=Number(p.correctIndex); if(!Number.isInteger(correctIndex)||correctIndex<0||correctIndex>=options.length)throw bad("حدد الإجابة الصحيحة من بين الخيارات.");
  const explanation=clean(p.explanation,"التوضيح",1500,false),difficulty=["easy","normal","hard"].includes(p.difficulty)?p.difficulty:"normal",sortOrder=Number.isSafeInteger(Number(p.sortOrder))?Number(p.sortOrder):0;
  const now=new Date().toISOString();
  const sourceYear=Number.isInteger(Number(p.sourceYear))?Number(p.sourceYear):new Date().getFullYear(); const sourceFile=clean(p.sourceFile||"لوحة الإدارة","اسم النموذج",500); const sourceIndex=Number.isSafeInteger(Number(p.sourceIndex))?Number(p.sourceIndex):sortOrder+1; const data={course_id:courseId,question_text:questionText,options,correct_index:correctIndex,explanation,difficulty,source_year:sourceYear,source_file:sourceFile,source_index:sourceIndex,sort_order:sortOrder,updated_by:Number(auth.telegramId)||null,updated_at:now};
  let result;
  if(p.id){const id=positive(p.id,"السؤال");const {data:current,error}=await supabase.from("academic_questions").select("*").eq("id",id).maybeSingle();if(error)throw error;if(!current)throw bad("السؤال غير موجود.","NOT_FOUND",404);requireCourse(auth,Number(current.course_id));const {data:row,error:saveError}=await supabase.from("academic_questions").update(data).eq("id",id).select("*").single();if(saveError)throw saveError;result=row;}
  else {const active=has(auth,"questions.publish")&&p.isActive!==false;const {data:row,error}=await supabase.from("academic_questions").insert({...data,source_question_id:"admin:"+crypto.randomUUID(),source_year:sourceYear,source_file:sourceFile,source_index:sourceIndex,review_flags:[],review_status:"approved",is_active:active,created_by:Number(auth.telegramId)}).select("*").single();if(error)throw error;result=row;}
  return {saved:mapQuestion(result)};
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
async function importModelJson(auth:any,p:any) {
  if (!auth?.isOwner) throw bad("استيراد النماذج مخصص للمدير الرئيسي فقط.", "FORBIDDEN", 403);
  const courseId=positive(p.courseId,"المقرر");
  const sourceYear=Number(p.sourceYear);
  if(!Number.isSafeInteger(sourceYear)||sourceYear<0||sourceYear>2100) throw bad("سنة النموذج غير صالحة.");
  const sourceSystem=clean(p.sourceSystem,"النظام الدراسي",80);
  const sourceAudience=clean(p.sourceAudience,"الفئة المستهدفة",20);
  if(!["طلاب","طالبات"].includes(sourceAudience)) throw bad("الفئة المستهدفة يجب أن تكون طلابًا أو طالبات.");
  const modelName=clean(p.sourceFile,"اسم النموذج",400);
  const sourceFile="⟦نظام:"+sourceSystem.replace(/[⟦⟧]/g,"")+"⟧⟦الفئة:"+sourceAudience+"⟧ "+modelName;
  if(sourceFile.length>500) throw bad("اسم النموذج مع النظام والفئة أطول من المسموح.");
  if(!Array.isArray(p.questions)||p.questions.length<1||p.questions.length>500) throw bad("عدد الأسئلة يجب أن يكون من 1 إلى 500.");
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
  const rows=p.questions.map((raw:any,index:number)=>{
    if(!raw||typeof raw!=="object"||Array.isArray(raw)) throw bad("بيانات السؤال رقم "+(index+1)+" غير صالحة.");
    const questionText=clean(raw.questionText??raw.question??raw.text,"نص السؤال "+(index+1),3000);
    const rawOptions=raw.options??raw.choices;
    if(!Array.isArray(rawOptions)) throw bad("خيارات السؤال رقم "+(index+1)+" يجب أن تكون مصفوفة.");
    const options=rawOptions.map((v:any)=>typeof v==="string"?v.trim():String(v?.text??v?.label??v?.value??"").trim());
    if(options.length<2||options.length>8||options.some((v:string)=>!v||v.length>500)) throw bad("السؤال رقم "+(index+1)+" يجب أن يحتوي من خيارين إلى 8 خيارات غير فارغة.");
    const rawAnswer=raw.correctIndex??raw.correctAnswer??raw.answerIndex??raw.answer;
    const correctIndex=typeof rawAnswer==="string"&&!/^\d+$/.test(rawAnswer)
      ? options.findIndex((v:string)=>v===rawAnswer.trim()) : Number(rawAnswer);
    if(!Number.isInteger(correctIndex)||correctIndex<0||correctIndex>=options.length) throw bad("الإجابة الصحيحة للسؤال رقم "+(index+1)+" غير صالحة.");
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
      review_flags:[],
      review_status:"approved",
      sort_order:index+1,
      is_active:true,
      created_by:actorId,
      updated_by:actorId,
    };
  });
  const {data,error}=await supabase.from("academic_questions").insert(rows).select("id");
  if(error) throw error;
  return {imported:data?.length??rows.length,skipped:false,courseId,sourceYear,sourceFile};
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
  if (!internalAuthorized) return json({error:"غير مصرح."},401);
  try {
    const body=await req.json(), action=String(body.action||""), p=body.payload||{}, auth=body.auth||{};
    let result:any;
    if(action==="dashboard") {
      if(!auth.isOwner && !["levels.read","levels.write","subjects.read","subjects.write","courses.read","courses.write","questions.read","questions.write","questions.publish","questions.delete","statistics.read","audit.read"].some((x:string)=>has(auth,x))) throw bad("غير مصرح.","FORBIDDEN",403);
      result=await dashboard(p.summaryOnly === true);
    } else if(action==="dashboardSummary") {
      if(!auth.isOwner && !["levels.read","levels.write","subjects.read","subjects.write","courses.read","courses.write","questions.read","questions.write","questions.publish","questions.delete","statistics.read","audit.read"].some((x:string)=>has(auth,x))) throw bad("غير مصرح.","FORBIDDEN",403);
      result=await dashboardSummary();
    } else if(action==="questionsPage") result=await questionsPage(auth,p);
    else if(action==="listStudents") result=await listStudents(auth);
    else if(action==="setStudentStatus") result=await setStudentStatus(auth,p);
    else if(action==="saveLevel") result=await saveLevel(auth,p);
    else if(action==="setLevelActive") result=await setLevelActive(auth,p);
    else if(action==="saveSubject") result=await saveSubject(auth,p);
    else if(action==="setSubjectActive") result=await setSubjectActive(auth,p);
    else if(action==="saveCourse") result=await saveCourse(auth,p);
    else if(action==="setCourseActive") result=await setCourseActive(auth,p);
    else if(action==="saveQuestion") result=await saveQuestion(auth,p);
    else if(action==="importModelJson") result=await importModelJson(auth,p);
    else if(action==="approveQuestionChange") result=await approveQuestionChange(auth,p);
    else if(action==="questionHistory") result=await questionHistory(auth);
    else if(action==="setQuestionActive") result=await setQuestionActive(auth,p);
    else if(action==="renameModel") result=await renameModel(auth,p);
    else if(action==="setModelActive") result=await setModelActive(auth,p);
    else throw bad("العملية المطلوبة غير معروفة.","UNKNOWN_ACTION",404);
    return json(result);
  } catch(e:any) {
    const code=e?.code||"SUPABASE_ERROR";
    const status=e?.status||(/duplicate key|unique constraint/i.test(e?.message||"")?409:400);
    const message=/duplicate key|unique constraint/i.test(e?.message||"")?"يوجد سجل بهذا الاسم بالفعل.":(e?.message||"تعذر تنفيذ العملية.");
    return json({error:message,code},status);
  }
});
