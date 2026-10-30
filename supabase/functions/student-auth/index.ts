import { createClient } from "npm:@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!, SERVICE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON=Deno.env.get("SUPABASE_ANON_KEY")!;
const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const cors={"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"https://app8964547541.tgcloud.ai","Access-Control-Allow-Headers":"content-type,authorization","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:cors});
const fail=(m:string,s=400)=>Object.assign(new Error(m),{status:s});
const clean=(v:unknown,n=150)=>typeof v==="string"?v.trim().slice(0,n):"";
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const body=await req.json(),action=clean(body.action,30),p=body.payload||{};
  if(action==="levels"){const {data,error}=await admin.from("academic_levels").select("id,name,sort_order").eq("is_active",true).order("sort_order");if(error)throw error;return json({levels:data||[]});}
  if(action==="signup")throw fail("التسجيل الجديد يتم عبر فتح المنصة من داخل Telegram.",410);
  if(action==="refresh"){
   const refreshToken=clean(p.refreshToken,5000);if(!refreshToken)throw fail("رمز الجلسة غير موجود؛ سجّل الدخول مجددًا.",401);
   const client=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data,error}=await client.auth.refreshSession({refresh_token:refreshToken});
   if(error||!data.session||!data.user)throw fail("انتهت جلسة الدخول؛ سجّل الدخول مجددًا.",401);
   const {data:profile,error:pe}=await admin.from("app_student_profiles").select("user_id,username,display_name,level_id,approval_status,role,academic_levels(name)").eq("user_id",data.user.id).single();
   if(pe||!profile)throw fail("لم يُعثر على ملف الحساب.",403);
   if(profile.role!=="admin" && ["suspended","blocked"].includes(String(profile.approval_status)))throw fail("هذا الحساب موقوف حاليًا.",403);
   return json({ok:true,accessToken:data.session.access_token,refreshToken:data.session.refresh_token,expiresAt:data.session.expires_at,profile:{username:profile.username,displayName:profile.display_name,levelId:profile.level_id,levelName:(profile as any).academic_levels?.name,role:profile.role}});
  }
  if(action==="forgot"){return json({error:"استعادة كلمة المرور عبر البريد غير متاحة."},404);}
  if(action==="login"){
   const identifier=clean(p.username||p.identifier,64).toLowerCase(),password=typeof p.password==="string"?p.password:"";if(!identifier||!password)throw fail("أدخل اسم المستخدم وكلمة المرور.",401);
   let email="";
   {const {data:profile,error}=await admin.from("app_student_profiles").select("user_id,approval_status,role").eq("username",identifier).maybeSingle();if(error)throw error;if(!profile)throw fail("بيانات الدخول غير صحيحة.",401);if(profile.role!=="admin" && ["suspended","blocked"].includes(String(profile.approval_status)))throw fail("هذا الحساب موقوف حاليًا.",403);const {data:user,error:ae}=await admin.auth.admin.getUserById(profile.user_id);if(ae||!user.user?.email)throw fail("بيانات الدخول غير صحيحة.",401);email=user.user.email;}
   const client=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await client.auth.signInWithPassword({email,password});
   if(error){const msg=error.message||"";if(/email not confirmed/i.test(msg))throw fail("بيانات الدخول غير صحيحة.",401);if(/invalid login credentials/i.test(msg))throw fail("اسم المستخدم أو كلمة المرور غير صحيحة.",401);throw fail("تعذر تسجيل الدخول: "+msg,401);}
   if(!data.session)throw fail("لم يتم إنشاء جلسة دخول. حاول مرة أخرى.",401);
   const {data:profile,error:pe}=await admin.from("app_student_profiles").select("user_id,username,display_name,level_id,approval_status,role,academic_levels(name)").eq("user_id",data.user.id).single();if(pe||!profile)throw fail("لم يُعثر على ملف الطالب. تواصل مع الإدارة.",403);
   if(profile.role!=="admin" && ["suspended","blocked"].includes(String(profile.approval_status)))throw fail("هذا الحساب موقوف حاليًا.",403);
   return json({ok:true,pending:false,accessToken:data.session.access_token,refreshToken:data.session.refresh_token,expiresAt:data.session.expires_at,profile:{username:profile.username,displayName:profile.display_name,levelId:profile.level_id,levelName:(profile as any).academic_levels?.name,role:profile.role}});
  }
  if(action==="resetPassword"){
   const accessToken=clean(p.accessToken,5000),password=typeof p.password==="string"?p.password:"";
   if(!accessToken)throw fail("رابط الاستعادة غير صالح أو انتهت صلاحيته.");
   if(password.length<8)throw fail("كلمة المرور يجب ألا تقل عن 8 أحرف.");
   const {data:{user:resetUser},error:resetAuthError}=await admin.auth.getUser(accessToken);
   if(resetAuthError||!resetUser)throw fail("رابط الاستعادة غير صالح أو انتهت صلاحيته.");
   const {error:updateError}=await admin.auth.admin.updateUserById(resetUser.id,{password});
   if(updateError)throw fail("تعذر حفظ كلمة المرور الجديدة: "+updateError.message);
   return json({ok:true,message:"تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن."});
  }
  if(action==="setPassword"){
   const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");
   if(!token)throw fail("سجّل الدخول أولًا.",401);
   const {data:{user},error:authError}=await admin.auth.getUser(token);
   if(authError||!user)throw fail("انتهت جلسة الدخول؛ سجّل الدخول مجددًا.",401);
   const {data:profile,error:profileError}=await admin.from("app_student_profiles")
    .select("user_id,approval_status,role").eq("user_id",user.id).single();
   if(profileError||!profile)throw fail("لم يُعثر على ملف الحساب.",403);
   if(profile.role!=="admin" && ["suspended","blocked"].includes(String(profile.approval_status)))throw fail("هذا الحساب موقوف حاليًا.",403);
   const password=typeof p.password==="string"?p.password:"";
   if(password.length<8)throw fail("كلمة المرور يجب ألا تقل عن 8 أحرف.");
   const {error:updateError}=await admin.auth.admin.updateUserById(user.id,{password});
   if(updateError)throw fail("تعذر حفظ كلمة المرور: "+updateError.message);
   return json({ok:true,message:"تم حفظ كلمة مرور المتصفح."});
  }
  const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!token)throw fail("سجّل الدخول أولًا.",401);
  const {data:{user},error:authError}=await admin.auth.getUser(token);if(authError||!user)throw fail("انتهت جلسة الدخول؛ سجّل الدخول مجددًا.",401);
  const {data:profile,error:pe}=await admin.from("app_student_profiles").select("user_id,username,display_name,level_id,approval_status,role,academic_levels(name)").eq("user_id",user.id).single();if(pe||!profile)throw fail("لم يُعثر على ملف الطالب.",403);
  if(action==="me"){
   if(profile.role!=="admin" && ["suspended","blocked"].includes(String(profile.approval_status)))throw fail("هذا الحساب موقوف حاليًا.",403);
   if(profile.role!=="admin"&&profile.level_id==null)throw fail("حسابك غير مرتبط بمستوى دراسي. تواصل مع الإدارة.",403);
   return json({profile:{username:profile.username,displayName:profile.display_name,levelId:profile.level_id,levelName:(profile as any).academic_levels?.name,status:profile.approval_status,role:profile.role}});
  }
  if(action==="logout")return json({ok:true});
  if(action==="approve"||action==="pending"){if(profile.role!=="admin")throw fail("هذه العملية للمشرف فقط.",403);
   if(action==="pending"){const {data,error}=await admin.from("app_student_profiles").select("user_id,username,display_name,level_id,approval_status,created_at,academic_levels(name)").eq("approval_status","pending").order("created_at");if(error)throw error;return json({students:data||[]});}
   const userId=clean(p.userId,64),status=clean(p.status,20);if(!userId||!["approved","rejected","suspended"].includes(status))throw fail("بيانات الاعتماد غير صحيحة.");
   const {data,error}=await admin.from("app_student_profiles").update({approval_status:status,updated_at:new Date().toISOString()}).eq("user_id",userId).select("user_id,username,approval_status").single();if(error)throw error;return json({ok:true,profile:data});
  }
  throw fail("العملية غير معروفة.",404);
 }catch(e:any){return json({error:String(e?.message||"تعذر إكمال الطلب.")},e?.status||400);}
});