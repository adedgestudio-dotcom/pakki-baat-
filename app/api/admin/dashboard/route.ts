import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";

const plans:Record<string,{days:number;voiceMinutes:number;customerLimit:number|null}>={
 trial:{days:30,voiceMinutes:100,customerLimit:100},
 basic:{days:30,voiceMinutes:100,customerLimit:100},
 smart:{days:30,voiceMinutes:500,customerLimit:250},
 business:{days:30,voiceMinutes:1000,customerLimit:null}
};

function env(){return {base:process.env.NEXT_PUBLIC_SUPABASE_URL||"",service:process.env.SUPABASE_SERVICE_ROLE_KEY||""}}
async function sb(path:string,init:RequestInit={}){const {base,service}=env();const r=await fetch(base+"/rest/v1/"+path,{...init,headers:{apikey:service,Authorization:"Bearer "+service,"Content-Type":"application/json",...(init.headers||{})},cache:"no-store"});const t=await r.text();if(!r.ok)throw new Error(t||"Database request failed");return t?JSON.parse(t):null}
async function users(){const {base,service}=env();const r=await fetch(base+"/auth/v1/admin/users?per_page=1000",{headers:{apikey:service,Authorization:"Bearer "+service},cache:"no-store"});if(!r.ok)throw new Error("Could not load users");return (await r.json()).users||[]}
async function deleteAuthUser(userId:string){const {base,service}=env();const r=await fetch(base+"/auth/v1/admin/users/"+encodeURIComponent(userId),{method:"DELETE",headers:{apikey:service,Authorization:"Bearer "+service},cache:"no-store"});if(!r.ok)throw new Error((await r.text())||"Could not delete user")}
async function ensureAuthUser(userId:string){if(!userId)throw new Error("User is required");const all=await users();if(!all.some((u:any)=>u.id===userId))throw new Error("User not found")}
async function upsertSubscription(userId:string,values:Record<string,any>){
 await ensureAuthUser(userId);
 const now=new Date().toISOString();
 const rows=await sb("subscriptions?owner_id=eq."+encodeURIComponent(userId)+"&select=owner_id");
 if(rows?.length){
  await sb("subscriptions?owner_id=eq."+encodeURIComponent(userId),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({...values,updated_at:now})});
 }else{
  await sb("subscriptions",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({owner_id:userId,...values,updated_at:now})});
 }
}

async function activatePaidPlan(userId:string,plan:string,mode:"purchase"|"renewal"="purchase"){
 await ensureAuthUser(userId);
 const result=await sb("rpc/activate_paid_plan",{method:"POST",body:JSON.stringify({target_user_id:userId,target_plan:plan,activation_mode:mode})});
 return result;
}

function customerCount(payload:any){
 const names:string[]=[];
 const add=(value:any)=>{if(typeof value==="string"&&value.trim())names.push(value.trim().toLowerCase())};
 for(const x of payload?.jobs||[])add(x?.customer);
 for(const x of payload?.payments||[])add(x?.customer);
 for(const x of payload?.notes||[])add(x?.customer);
 for(const x of payload?.reminders||[])add(x?.customer);
 for(const key of Object.keys(payload?.customerPhones||{}))add(key);
 return new Set(names).size;
}

export async function GET(req:NextRequest){
 if(!isAdmin(req))return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const [authUsers,subs,usage,payments,claims,workspaces]=await Promise.all([
   users(),
   sb("subscriptions?select=*"),
   sb("ai_period_usage?select=owner_id,period_start,voice_seconds,ai_calls&order=period_start.desc"),
   sb("payment_requests?select=*&order=submitted_at.desc"),
   sb("trial_claims?select=first_owner_id,claimed_at"),
   sb("workspaces?select=owner_id,payload")
  ]);
  const usageMap=new Map();
  for(const x of usage||[]){if(!usageMap.has(x.owner_id))usageMap.set(x.owner_id,x);}
  const claimMap=new Map((claims||[]).map((x:any)=>[x.first_owner_id,x]));
  const workspaceMap=new Map((workspaces||[]).map((x:any)=>[x.owner_id,x.payload]));
  const now=Date.now();
  // Activate any already-paid pending downgrade whose previous period has ended before rendering Admin state.\n  await Promise.all((subs||[]).filter((s:any)=>s.pending_plan&&s.pending_period_end&&new Date(s.period_end).getTime()<=Date.now()).map((s:any)=>sb("rpc/apply_due_pending_plan",{method:"POST",body:JSON.stringify({target_user_id:s.owner_id})})));\n  const refreshedSubs=await sb("subscriptions?select=*");\n  const refreshedSubMap=new Map((refreshedSubs||[]).map((x:any)=>[x.owner_id,x]));\n  const list=authUsers.map((u:any)=>{
   const sub:any=refreshedSubMap.get(u.id)||{};
   const entitlement=plans[sub.plan]||null;
   const expired=!!sub.period_end&&new Date(sub.period_end).getTime()<=now;
   return {id:u.id,email:u.email||"",created_at:u.created_at,last_sign_in_at:u.last_sign_in_at,...sub,display_status:expired&&sub.status==="active"?"expired":sub.status,usage:usageMap.get(u.id)||null,trial_claim:claimMap.get(u.id)||null,customer_count:customerCount(workspaceMap.get(u.id)),voice_limit_minutes:entitlement?.voiceMinutes??0,customer_limit:entitlement?.customerLimit??null,has_subscription:Boolean(sub.owner_id),has_entitlement:Boolean(entitlement)};
  });
  return NextResponse.json({users:list,payments,stats:{totalUsers:list.length,pendingPayments:(payments||[]).filter((p:any)=>p.status==="pending").length,activePlans:list.filter((u:any)=>u.plan&&u.plan!=="trial"&&u.status==="active"&&new Date(u.period_end).getTime()>now).length,activeTrials:list.filter((u:any)=>u.plan==="trial"&&u.status==="active"&&new Date(u.period_end).getTime()>now).length,voiceSeconds:[...usageMap.values()].reduce((n:any,x:any)=>n+(x.voice_seconds||0),0),aiCalls:[...usageMap.values()].reduce((n:any,x:any)=>n+(x.ai_calls||0),0)}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Could not load admin data"},{status:500})}
}

export async function POST(req:NextRequest){
 if(!isAdmin(req))return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const b=await req.json();const action=String(b.action||"");const userId=String(b.userId||"");
  if(action==="review_payment"){
   const rows=await sb("payment_requests?id=eq."+encodeURIComponent(String(b.paymentId))+"&select=*");const p=rows?.[0];if(!p||p.status!=="pending")return NextResponse.json({error:"Payment is no longer pending."},{status:400});
   const status=b.decision==="approve"?"approved":"rejected";
   if(status==="approved"){
    if(!plans[p.plan]||p.plan==="trial")return NextResponse.json({error:"Payment has an invalid plan."},{status:400});
    // Activate access first. If activation fails, the payment remains pending and can be retried safely.
    await activatePaidPlan(p.owner_id,p.plan,"renewal");
    await sb("payment_requests?id=eq."+p.id,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"approved",reviewed_at:new Date().toISOString()})});
   }else{
    await sb("payment_requests?id=eq."+p.id,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:"rejected",reviewed_at:new Date().toISOString()})});
   }
  }else if(action==="change_plan"){
   if(!plans[b.plan]||b.plan==="trial")return NextResponse.json({error:"Invalid paid plan"},{status:400});
   await activatePaidPlan(userId,b.plan,"purchase");
  }else if(action==="add_voice"){
   const rows=await sb("subscriptions?owner_id=eq."+userId+"&select=bonus_voice_seconds,plan,status,period_start,period_end");if(!rows?.length)return NextResponse.json({error:"Assign a plan before adding bonus voice."},{status:400});const cur=rows[0]?.bonus_voice_seconds||0;const minutes=Math.max(0,Number(b.minutes)||0);await upsertSubscription(userId,{bonus_voice_seconds:cur+Math.round(minutes*60)});
  }else if(action==="extend"){
   const rows=await sb("subscriptions?owner_id=eq."+userId+"&select=plan");if(!rows?.length||!plans[rows[0]?.plan])return NextResponse.json({error:"Assign a plan before extending access."},{status:400});
   const days=Math.max(1,Math.min(3650,Math.round(Number(b.days)||30)));
   await sb("rpc/extend_subscription",{method:"POST",body:JSON.stringify({target_user_id:userId,extension_days:days})});
  }else if(action==="status"){
   const targetStatus=b.status==="suspended"?"suspended":"active";
   try{
    await sb("rpc/set_subscription_status",{method:"POST",body:JSON.stringify({target_user_id:userId,target_status:targetStatus})});
   }catch(error){
    const message=error instanceof Error?error.message:"";
    if(message.includes("SUBSCRIPTION_NOT_FOUND"))return NextResponse.json({error:"This user has no subscription to suspend or reactivate."},{status:400});
    if(message.includes("SUBSCRIPTION_EXPIRED"))return NextResponse.json({error:"This plan has expired. Extend it or apply a paid plan before reactivating."},{status:400});
    throw error;
   }
  }else if(action==="grant_trial"){
   await sb("rpc/admin_grant_trial",{method:"POST",body:JSON.stringify({target_user_id:userId})});
  }else if(action==="delete_user"){
   if(!userId)return NextResponse.json({error:"User is required"},{status:400});
   const authUsers=await users();const target=authUsers.find((u:any)=>u.id===userId);if(!target)return NextResponse.json({error:"User not found"},{status:404});
   if(String(target.email||"").toLowerCase()==="zorivoworks@gmail.com")return NextResponse.json({error:"The owner account cannot be deleted from Admin."},{status:400});
   await deleteAuthUser(userId);
  }else return NextResponse.json({error:"Unknown action"},{status:400});
  return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Admin action failed"},{status:500})}
}
