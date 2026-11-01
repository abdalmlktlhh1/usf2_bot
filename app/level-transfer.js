(() => {
  const dialog=document.getElementById("infoDialog"), body=document.getElementById("infoBody"), title=document.getElementById("infoTitle");
  if(!dialog||!body||!title||typeof window.studentApi!=="function") return;
  let loading=false;
  async function mount(){
    if(loading||dialog.classList.contains("hidden")||title.textContent.trim()!=="حسابي وتقدمي"||body.textContent.includes("جار تحميل بيانات حسابك")||body.querySelector("[data-level-transfer-card]")) return;
    loading=true;
    try{
      const me=await window.studentApi("me"); if(String(me?.profile?.role||"student").toLowerCase()!=="student") return;
      const data=await window.studentApi("levelTransferOptions");
      if(dialog.classList.contains("hidden")||title.textContent.trim()!=="حسابي وتقدمي"||body.querySelector("[data-level-transfer-card]")) return;
      const card=document.createElement("section");card.className="history-entry level-transfer-card";card.dataset.levelTransferCard="true";
      const h=document.createElement("h3");h.textContent="طلب النقل إلى مستوى آخر";
      const hint=document.createElement("p");hint.textContent="أرسل طلبك للإدارة. سيبقى مستواك الحالي كما هو حتى تراجع الإدارة الطلب.";
      const form=document.createElement("form");form.className="auth-grid";
      const label=document.createElement("label");label.textContent="المستوى المطلوب";const select=document.createElement("select");select.required=true;
      const empty=document.createElement("option");empty.value="";empty.textContent="اختر المستوى";select.append(empty);
      for(const level of data.levels||[]){const o=document.createElement("option");o.value=String(level.id);o.textContent=level.name+(Number(level.id)===Number(data.currentLevelId)?" — مستواك الحالي":"");o.disabled=Number(level.id)===Number(data.currentLevelId);select.append(o);}
      const reasonLabel=document.createElement("label");reasonLabel.textContent="سبب طلب النقل (اختياري)";const reason=document.createElement("textarea");reason.maxLength=500;reason.rows=3;reason.placeholder="اكتب سبب طلبك باختصار";
      const send=document.createElement("button");send.type="submit";send.className="btn primary";send.textContent="إرسال طلب النقل";const status=document.createElement("p");status.className="hint";status.setAttribute("role","status");
      const history=document.createElement("div");history.className="level-transfer-history";const requests=Array.isArray(data.requests)?data.requests:[];
      if(requests.length){const sub=document.createElement("h4");sub.textContent="طلباتك السابقة";history.append(sub);for(const r of requests){const row=document.createElement("p"),level=(data.levels||[]).find(x=>Number(x.id)===Number(r.requested_level_id));const state=r.status==="pending"?"قيد المراجعة":r.status==="approved"?"تمت الموافقة":r.status==="rejected"?"مرفوض":"ملغي";row.textContent=(level?.name||"المستوى المطلوب")+" — "+state+(r.review_note?" · "+r.review_note:"");history.append(row);}}
      if(requests.some(r=>r.status==="pending")){send.disabled=true;status.textContent="لديك طلب نقل قيد المراجعة بالفعل.";}
      form.append(label,select,reasonLabel,reason,send,status);card.append(h,hint,form,history);body.append(card);
      form.addEventListener("submit",async e=>{e.preventDefault();status.textContent="";const requestedLevelId=Number(select.value);if(!Number.isSafeInteger(requestedLevelId)||requestedLevelId<=0){status.textContent="اختر المستوى المطلوب.";return;}send.disabled=true;try{await window.studentApi("requestLevelTransfer",{requestedLevelId,reason:reason.value.trim()});status.textContent="تم إرسال طلبك إلى الإدارة. لن يتغير مستواك حتى تتم مراجعته.";reason.value="";select.value="";send.textContent="تم إرسال الطلب";}catch(error){status.textContent=error?.message||"تعذر إرسال طلب النقل.";send.disabled=false;}});
    }catch(error){console.warn("تعذر تحميل نموذج نقل المستوى:",error);}finally{loading=false;}
  }
  const observer=new MutationObserver(()=>{void mount();});observer.observe(body,{childList:true,subtree:true});observer.observe(dialog,{attributes:true,attributeFilter:["class"]});
})();
