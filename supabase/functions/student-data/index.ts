import { createClient } from "npm:@supabase/supabase-js@2";
const INTERNAL_SECRET_HASH_NAME = "student-data";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type":"application/json; charset=utf-8", "Access-Control-Allow-Origin":"https://app8964547541.tgcloud.ai", "Access-Control-Allow-Headers":"content-type,x-student-sync-secret", "Access-Control-Allow-Methods":"POST,OPTIONS" } });
const bad = (message:string,status=400) => Object.assign(new Error(message),{status});
const asId = (v:unknown,label:string) => {const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw bad(label+" غير صالح.");return n;};
const safeString = (v:unknown,max=300) => typeof v==="string"?v.trim().slice(0,max):"";
let internalSecretHashPromise:Promise<string|null>|null=null;
async function verifyInternalRequest(req:Request):Promise<boolean>{
 const supplied=req.headers.get("x-student-sync-secret");
 if(!supplied||supplied.length>256)return false;
 const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(supplied));
 const digest=[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,"0")).join("");
 if(!internalSecretHashPromise){
  internalSecretHashPromise=supabase.from("internal_service_secret_hashes")
   .select("secret_sha256").eq("secret_name",INTERNAL_SECRET_HASH_NAME).maybeSingle()
   .then(({data,error})=>{
    if(error){internalSecretHashPromise=null;throw error;}
    const value=typeof data?.secret_sha256==="string"?data.secret_sha256.trim().toLowerCase():"";
    return /^[a-f0-9]{64}$/.test(value)?value:null;
   });
 }
 const expected=await internalSecretHashPromise;
 if(!expected||digest.length!==expected.length)return false;
 let difference=0;
 for(let i=0;i<digest.length;i++)difference|=digest.charCodeAt(i)^expected.charCodeAt(i);
 return difference===0;
}

async function ensureProfile(auth:any) {
 const id=asId(auth?.telegramId,"حساب Telegram"),p=auth?.profile||{};
 const first_name=safeString(p.first_name,120),last_name=safeString(p.last_name,120),username=safeString(p.username,64);
 const display_name=[first_name,last_name].filter(Boolean).join(" ")||(username?"@"+username:"طالب");
 const {error}=await supabase.from("student_profiles").upsert({telegram_id:id,username,first_name,last_name,display_name,last_seen_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"telegram_id"});
 if(error)throw error;return id;
}
async function myData(id:number) {
 const [p,g,a]=await Promise.all([
  supabase.from("student_profiles").select("telegram_id,username,first_name,last_name,display_name,created_at,last_seen_at").eq("telegram_id",id).single(),
  supabase.from("student_progress").select("id,course_id,academic_courses(name),source_year,source_file,attempt_id,current_index,answers,checked_question_ids,status,updated_at").eq("telegram_id",id).order("updated_at",{ascending:false}).limit(100),
  supabase.from("student_attempts").select("id,course_id,academic_courses(name),source_year,source_file,model_label,question_ids,answers,total_questions,graded_questions,correct_count,wrong_count,blank_count,score_percent,duration_seconds,status,started_at,completed_at").eq("telegram_id",id).order("started_at",{ascending:false}).limit(50)
 ]);
 if(p.error)throw p.error;if(g.error)throw g.error;if(a.error)throw a.error;
 return {profile:p.data,progress:g.data||[],attempts:a.data||[]};
}
async function startAttempt(id:number,p:any) {
 const courseId=asId(p.courseId,"المقرر");
 const {data:course,error:ce}=await supabase.from("academic_courses").select("id,is_active").eq("id",courseId).single();
 if(ce||!course||!course.is_active)throw bad("المقرر غير متاح.",404);
 const questionIds=Array.isArray(p.questionIds)?p.questionIds.filter((x:any)=>typeof x==="string"&&x.length<=300).slice(0,1000):[];
 if(!questionIds.length)throw bad("لا توجد أسئلة صالحة لحفظ المحاولة.");
 const sourceYear=Number.isInteger(Number(p.sourceYear))?Number(p.sourceYear):0,sourceFile=safeString(p.sourceFile,500),modelLabel=safeString(p.modelLabel,250);
 const {data:attempt,error}=await supabase.from("student_attempts").insert({telegram_id:id,course_id:courseId,source_year:sourceYear,source_file:sourceFile,model_label:modelLabel,question_ids:questionIds,answers:{},total_questions:questionIds.length,status:"in_progress"}).select("id,course_id,source_year,source_file,model_label,total_questions,status,started_at").single();
 if(error)throw error;
 const {error:pe}=await supabase.from("student_progress").upsert({telegram_id:id,course_id:courseId,source_year:sourceYear,source_file:sourceFile,attempt_id:attempt.id,current_index:0,answers:{},checked_question_ids:[],status:"in_progress",updated_at:new Date().toISOString()},{onConflict:"telegram_id,course_id,source_year,source_file"});
 if(pe)throw pe;return {attempt};
}
async function saveProgress(id:number,p:any) {
 const attemptId=safeString(p.attemptId,64);
 const {data:cur,error:ce}=await supabase.from("student_attempts").select("id,course_id,source_year,source_file,status,question_ids").eq("id",attemptId).eq("telegram_id",id).single();
 if(ce||!cur)throw bad("المحاولة غير موجودة.",404);if(cur.status!=="in_progress")throw bad("المحاولة منتهية ولا تقبل تعديلات.");
 const ids=Array.isArray(cur.question_ids)?cur.question_ids:[],raw=p.answers&&typeof p.answers==="object"&&!Array.isArray(p.answers)?p.answers:{},answers:any={};
 for(const [key,value] of Object.entries(raw))if(ids.includes(key)&&Number.isInteger(value)&&Number(value)>=0&&Number(value)<10)answers[key]=value;
 const checked=Array.isArray(p.checkedQuestionIds)?p.checkedQuestionIds.filter((x:any)=>ids.includes(x)).slice(0,1000):[];
 const currentIndex=Math.max(0,Math.min(Math.max(0,ids.length-1),Number.isInteger(Number(p.currentIndex))?Number(p.currentIndex):0)),now=new Date().toISOString();
 const {error}=await supabase.from("student_progress").upsert({telegram_id:id,course_id:cur.course_id,source_year:cur.source_year,source_file:cur.source_file,attempt_id:cur.id,current_index:currentIndex,answers,checked_question_ids:checked,status:"in_progress",updated_at:now},{onConflict:"telegram_id,course_id,source_year,source_file"});
 if(error)throw error;
 const {error:ae}=await supabase.from("student_attempts").update({answers,updated_at:now}).eq("id",cur.id).eq("telegram_id",id);if(ae)throw ae;
 return {saved:true,currentIndex};
}
async function completeAttempt(id:number,p:any) {
 const attemptId=safeString(p.attemptId,64);
 const {data:cur,error:ce}=await supabase.from("student_attempts").select("id,course_id,source_year,source_file,question_ids,status").eq("id",attemptId).eq("telegram_id",id).single();
 if(ce||!cur)throw bad("المحاولة غير موجودة.",404);if(cur.status==="completed")return {saved:true,alreadyCompleted:true};
 const ids=Array.isArray(cur.question_ids)?cur.question_ids:[],raw=p.answers&&typeof p.answers==="object"&&!Array.isArray(p.answers)?p.answers:{},answers:any={};
 for(const [key,value] of Object.entries(raw))if(ids.includes(key)&&Number.isInteger(value)&&Number(value)>=0&&Number(value)<10)answers[key]=value;
 const total=Math.min(1000,Math.max(0,Number(p.totalQuestions)||ids.length)),graded=Math.min(total,Math.max(0,Number(p.gradedQuestions)||0));
 const correct=Math.min(graded,Math.max(0,Number(p.correctCount)||0)),wrong=Math.min(graded-correct,Math.max(0,Number(p.wrongCount)||0)),blank=Math.min(graded-correct-wrong,Math.max(0,Number(p.blankCount)||0));
 const duration=Math.min(86400,Math.max(0,Number(p.durationSeconds)||0)),pct=graded?Math.round(correct/graded*10000)/100:null,now=new Date().toISOString();
 const {error}=await supabase.from("student_attempts").update({answers,total_questions:total,graded_questions:graded,correct_count:correct,wrong_count:wrong,blank_count:blank,score_percent:pct,duration_seconds:duration,status:"completed",completed_at:now,updated_at:now}).eq("id",cur.id).eq("telegram_id",id);
 if(error)throw error;
 const {error:pe}=await supabase.from("student_progress").upsert({telegram_id:id,course_id:cur.course_id,source_year:cur.source_year,source_file:cur.source_file,attempt_id:cur.id,current_index:Math.max(0,ids.length-1),answers,checked_question_ids:ids,status:"completed",updated_at:now},{onConflict:"telegram_id,course_id,source_year,source_file"});
 if(pe)throw pe;return {saved:true,scorePercent:pct};
}

async function getMistakes(id:number,p:any={}) {
 let query=supabase.from("student_question_mistakes").select("question_id,course_id,wrong_count,mastered_count,is_active,first_wrong_at,last_wrong_at,last_correct_at,updated_at").eq("telegram_id",id).order("last_wrong_at",{ascending:false}).limit(1000);
 if(p.includeMastered!==true) query=query.eq("is_active",true);
 const courseId=Number(p.courseId||0);if(Number.isSafeInteger(courseId)&&courseId>0)query=query.eq("course_id",courseId);
 const {data,error}=await query;if(error)throw error;
 return {mistakes:data||[],activeCount:(data||[]).filter((x:any)=>x.is_active).length,masteredCount:(data||[]).filter((x:any)=>!x.is_active).length};
}
async function recordQuestionOutcomes(id:number,cur:any,p:any) {
 const attemptIds=Array.isArray(cur.question_ids)?cur.question_ids.filter((x:any)=>typeof x==="string"):[];
 const allowed=new Set(attemptIds);
 const wrong=[...new Set((Array.isArray(p.mistakeQuestionIds)?p.mistakeQuestionIds:[]).filter((x:any)=>typeof x==="string"&&allowed.has(x)))].slice(0,1000);
 const correct=[...new Set((Array.isArray(p.correctQuestionIds)?p.correctQuestionIds:[]).filter((x:any)=>typeof x==="string"&&allowed.has(x)&&!wrong.includes(x)))].slice(0,1000);
 if(!wrong.length&&!correct.length)return {recorded:0};
 const candidates=[...new Set([...wrong,...correct])];
 const externalIds=candidates.filter((x:string)=>!x.startsWith("db:")&&x.length<=300);
 const numericIds=candidates.filter((x:string)=>/^db:\d+$/.test(x)).map((x:string)=>Number(x.slice(3))).filter((x:number)=>Number.isSafeInteger(x)&&x>0);
 const valid=new Set<string>();
 if(externalIds.length){
  const {data,error}=await supabase.from("academic_questions").select("id,source_question_id").eq("course_id",cur.course_id).in("source_question_id",externalIds);
  if(error)throw error;
  for(const row of data||[]){if(row.source_question_id)valid.add(String(row.source_question_id));valid.add("db:"+String(row.id));}
 }
 if(numericIds.length){
  const {data,error}=await supabase.from("academic_questions").select("id,source_question_id").eq("course_id",cur.course_id).in("id",numericIds);
  if(error)throw error;
  for(const row of data||[]){valid.add("db:"+String(row.id));if(row.source_question_id)valid.add(String(row.source_question_id));}
 }
 const now=new Date().toISOString(),rows:any[]=[];
 for(const questionId of wrong)if(valid.has(questionId))rows.push({telegram_id:id,attempt_id:cur.id,question_id:questionId,course_id:cur.course_id,outcome:"wrong",answered_at:now});
 for(const questionId of correct)if(valid.has(questionId))rows.push({telegram_id:id,attempt_id:cur.id,question_id:questionId,course_id:cur.course_id,outcome:"correct",answered_at:now});
 for(let i=0;i<rows.length;i+=200){const {error}=await supabase.from("student_question_outcomes").upsert(rows.slice(i,i+200),{onConflict:"telegram_id,attempt_id,question_id",ignoreDuplicates:true});if(error)throw error;}
 return {recorded:rows.length};
}

async function getBookmarks(id:number) {
 const {data,error}=await supabase.from("student_question_bookmarks").select("question_id,created_at").eq("telegram_id",id).order("created_at",{ascending:false}).limit(5000);
 if(error)throw error;
 return {questionIds:(data||[]).map((row:any)=>String(row.question_id))};
}
async function syncBookmarks(id:number,p:any) {
 const incoming=Array.isArray(p.questionIds)?[...new Set(p.questionIds.map((v:any)=>safeString(v,300)).filter(Boolean))].slice(0,5000):[];
 for(let i=0;i<incoming.length;i+=500) {
  const rows=incoming.slice(i,i+500).map((question_id:string)=>({telegram_id:id,question_id}));
  const {error}=await supabase.from("student_question_bookmarks").upsert(rows,{onConflict:"telegram_id,question_id",ignoreDuplicates:true});
  if(error)throw error;
 }
 return await getBookmarks(id);
}
async function setBookmark(id:number,p:any,remove:boolean) {
 const questionId=safeString(p.questionId,300);
 if(!questionId)throw bad("معرّف السؤال غير صالح.");
 if(remove) {
  const {error}=await supabase.from("student_question_bookmarks").delete().eq("telegram_id",id).eq("question_id",questionId);
  if(error)throw error;
  return {saved:false,questionId};
 }
 const {error}=await supabase.from("student_question_bookmarks").upsert({telegram_id:id,question_id:questionId},{onConflict:"telegram_id,question_id",ignoreDuplicates:true});
 if(error)throw error;
 return {saved:true,questionId};
}


function randomPassword() {
 // 32 random bytes become 64 ASCII hex characters, below bcrypt's 72-byte input limit.
 const bytes = crypto.getRandomValues(new Uint8Array(32));
 return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function telegramAppProfile(id:number, p:any, auth:any) {
 const firstName=safeString(auth?.profile?.first_name,120);
 const lastName=safeString(auth?.profile?.last_name,120);
 const tgUsername=safeString(auth?.profile?.username,64);
 const photoUrl=safeString(auth?.profile?.photo_url,1000);
 const telegramName=[firstName,lastName].filter(Boolean).join(" ") || (tgUsername ? "@"+tgUsername : "طالب");
 const now=new Date().toISOString();

 let {data:profile,error:profileError}=await supabase
  .from("app_student_profiles")
  .select("user_id,telegram_id,username,display_name,level_id,approval_status,role")
  .eq("telegram_id",id)
  .maybeSingle();
 if(profileError)throw profileError;

 if(!profile && id===5187563344) {
  const {data:ownerProfile,error:ownerError}=await supabase.from("app_student_profiles")
   .select("user_id,telegram_id,username,display_name,level_id,approval_status,role")
   .eq("username","law1").eq("role","admin").maybeSingle();
  if(ownerError)throw ownerError;
  if(!ownerProfile)throw bad("تعذر العثور على حساب المدير الرئيسي.");
  if(ownerProfile.telegram_id!=null && Number(ownerProfile.telegram_id)!==id) {
   throw bad("حساب المدير الرئيسي مرتبط بحساب Telegram آخر.",403);
  }
  const {data:linked,error:linkError}=await supabase.from("app_student_profiles")
   .update({telegram_id:id,telegram_username:tgUsername||null,telegram_first_name:firstName||null,telegram_last_name:lastName||null,telegram_photo_url:/^https:\/\/[^ ]+$/i.test(photoUrl)?photoUrl:null,last_telegram_login_at:now,updated_at:now})
   .eq("user_id",ownerProfile.user_id)
   .select("user_id,telegram_id,username,display_name,level_id,approval_status,role").single();
  if(linkError||!linked)throw linkError||bad("تعذر ربط حساب المدير الرئيسي.");
  profile=linked;
 }
 if(!profile && id===5187563344)throw bad("لم يتم ربط حساب المدير الرئيسي بأمان.",403);

 if(!profile) {
  const levelId=Number(p?.levelId);
  if(!Number.isSafeInteger(levelId)||levelId<=0) {
   const {data:levels,error:levelsError}=await supabase.from("academic_levels")
    .select("id,name,sort_order").eq("is_active",true).order("sort_order");
   if(levelsError)throw levelsError;
   return {needsLevel:true,levels:levels||[],telegramProfile:{
    displayName:telegramName,username:tgUsername,photoUrl:photoUrl
   }};
  }

  const {data:level,error:levelError}=await supabase.from("academic_levels")
   .select("id").eq("id",levelId).eq("is_active",true).maybeSingle();
  if(levelError||!level)throw bad("المستوى الدراسي غير متاح.");

  const email="telegram-"+String(id)+"@accounts.invalid";
  const {data:created,error:createError}=await supabase.auth.admin.createUser({
   email,
   password:randomPassword(),
   email_confirm:true,
   user_metadata:{
    level_id:levelId,
    display_name:telegramName,
    telegram_id:String(id),
    telegram_username:tgUsername
   }
  });
  if(createError) {
   if(/already.*registered|already.*exists/i.test(createError.message||"")) {
    throw bad("يوجد حساب تيليجرام مرتبط جزئيًا. تواصل مع إدارة المنصة لاستكمال ربطه.");
   }
   throw createError;
  }
  if(!created.user)throw bad("تعذر إنشاء حساب المنصة.");

  const {data:updated,error:updateError}=await supabase.from("app_student_profiles")
   .update({
    telegram_id:id,
    telegram_username:tgUsername||null,
    telegram_first_name:firstName||null,
    telegram_last_name:lastName||null,
    telegram_photo_url:/^https:\/\/[^ ]+$/i.test(photoUrl)?photoUrl:null,
    last_telegram_login_at:now,
    approval_status:"approved",
    updated_at:now
   })
   .eq("user_id",created.user.id)
   .select("user_id,username,display_name,level_id,approval_status,role")
   .single();
  if(updateError||!updated) {
   await supabase.auth.admin.deleteUser(created.user.id);
   throw updateError||bad("تعذر إكمال إنشاء الحساب.");
  }
  profile=updated;
 } else {
  if(profile.role!=="admin" && ["suspended","blocked"].includes(String(profile.approval_status))) {
   throw bad("هذا الحساب موقوف حاليًا. تواصل مع إدارة المنصة.",403);
  }
  const updateData:any={
   telegram_username:tgUsername||null,
   telegram_first_name:firstName||null,
   telegram_last_name:lastName||null,
   telegram_photo_url:/^https:\/\/[^ ]+$/i.test(photoUrl)?photoUrl:null,
   last_telegram_login_at:now,
   updated_at:now
  };
  if(profile.role!=="admin" && profile.level_id==null) {
   const requestedLevel=Number(p?.levelId);
   if(!Number.isSafeInteger(requestedLevel)||requestedLevel<=0) {
    const {data:levels,error}=await supabase.from("academic_levels")
     .select("id,name,sort_order").eq("is_active",true).order("sort_order");
    if(error)throw error;
    return {needsLevel:true,levels:levels||[],telegramProfile:{displayName:telegramName,username:tgUsername,photoUrl}};
   }
   const {data:level,error:levelError}=await supabase.from("academic_levels")
    .select("id").eq("id",requestedLevel).eq("is_active",true).maybeSingle();
   if(levelError||!level)throw bad("المستوى الدراسي غير متاح.");
   updateData.level_id=requestedLevel;
  }
  if(profile.role!=="admin" && profile.approval_status!=="approved") updateData.approval_status="approved";
  if(!profile.display_name) updateData.display_name=telegramName;
  const {data:updated,error:updateError}=await supabase.from("app_student_profiles")
   .update(updateData).eq("user_id",profile.user_id)
   .select("user_id,username,display_name,level_id,approval_status,role").single();
  if(updateError||!updated)throw updateError||bad("تعذر تحديث ملف الحساب.");
  profile=updated;
 }

 if(profile.role!=="admin" && !profile.level_id) {
  const {data:levels,error}=await supabase.from("academic_levels")
   .select("id,name,sort_order").eq("is_active",true).order("sort_order");
  if(error)throw error;
  return {needsLevel:true,levels:levels||[]};
 }

 const {data:userData,error:userError}=await supabase.auth.admin.getUserById(profile.user_id);
 if(userError||!userData.user?.email)throw bad("تعذر التحقق من حساب المنصة.");
 const anonKey=Deno.env.get("SUPABASE_ANON_KEY");
 if(!anonKey)throw bad("إعدادات المصادقة غير مكتملة على الخادم.",500);
 const {data:linkData,error:linkError}=await supabase.auth.admin.generateLink({
  type:"magiclink",
  email:userData.user.email
 });
 if(linkError)throw linkError;
 const tokenHash=(linkData as any)?.properties?.hashed_token;
 if(typeof tokenHash!=="string"||!tokenHash)throw bad("تعذر إنشاء جلسة دخول آمنة.",500);

 const anon=createClient("https://jrrsnpijbizbwxopyvam.supabase.co",anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:sessionData,error:sessionError}=await anon.auth.verifyOtp({
  token_hash:tokenHash,
  type:"email"
 });
 if(sessionError||!sessionData.session)throw sessionError||bad("تعذر إنشاء جلسة الدخول.",500);

 const {data:levelData}=profile.level_id
  ? await supabase.from("academic_levels").select("name").eq("id",profile.level_id).maybeSingle()
  : {data:null};
 return {
  ok:true,
  accessToken:sessionData.session.access_token,
  refreshToken:sessionData.session.refresh_token,
  expiresAt:sessionData.session.expires_at,
  profile:{
   username:profile.username,
   displayName:profile.display_name||telegramName,
   levelId:profile.level_id,
   levelName:levelData?.name||null,
   role:profile.role
  }
 };
}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return json({ok:true});if(req.method!=="POST")return json({error:"Method not allowed"},405);
 if(!(await verifyInternalRequest(req)))return json({error:"غير مصرح."},401);
 try {
  const body=await req.json(),action=String(body.action||""),p=body.payload||{},auth=body.auth||{},id=await ensureProfile(auth);let result:any;
  if(action==="appAuth")result=await telegramAppProfile(id,p,auth);
  else if(action==="me")result=await myData(id);
  else if(action==="mistakes")result=await getMistakes(id,p);
  else if(action==="getBookmarks")result=await getBookmarks(id);
  else if(action==="syncBookmarks")result=await syncBookmarks(id,p);
  else if(action==="saveBookmark")result=await setBookmark(id,p,false);
  else if(action==="removeBookmark")result=await setBookmark(id,p,true);
  else if(action==="startAttempt")result=await startAttempt(id,p);
  else if(action==="saveProgress")result=await saveProgress(id,p);
  else if(action==="completeAttempt")result=await completeAttempt(id,p);
  else if(action==="abandonAttempt"){
   const attemptId=safeString(p.attemptId,64),{data:row,error:re}=await supabase.from("student_attempts").select("id,course_id,source_year,source_file").eq("id",attemptId).eq("telegram_id",id).single();
   if(re||!row)throw bad("المحاولة غير موجودة.",404);const now=new Date().toISOString();
   const {error}=await supabase.from("student_attempts").update({status:"abandoned",updated_at:now}).eq("id",row.id).eq("telegram_id",id);if(error)throw error;
   const {error:pe}=await supabase.from("student_progress").update({status:"abandoned",updated_at:now}).eq("telegram_id",id).eq("course_id",row.course_id).eq("source_year",row.source_year).eq("source_file",row.source_file);if(pe)throw pe;result={saved:true};
  } else throw bad("العملية المطلوبة غير معروفة.",404);
  return json(result);
 }catch(e:any){return json({error:String(e?.message||"تعذر حفظ بيانات الطالب.")},e?.status||400);}
});
