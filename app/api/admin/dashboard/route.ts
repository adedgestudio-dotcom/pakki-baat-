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
  const month=new Date().toISOString().slice(0,7)+"-01";
  const [authUsers,subs,usage,payments,claims,workspaces]=await Promise.all([
   users(),
   sb("subscriptions?select=*"),
   sb("ai_monthly_usage?select=owner_id,period_month,voice_seconds,ai_calls&period_month=eq."+month),
   sb("payment_requests?select=*&order=submitted_at.desc"),
   sb("trial_claims?select=first_owner_id,claimed_at"),
   sb("workspaces?select=owner_id,payload")
  ]);
  const usageMap=new Map((usage||[]).map((x:any)=>[x.owner_id,x]));
  const subMap=new Map((subs||[]).map((x:any)=>[x.owner_id,x]));
  const claimMap=new Map((claims||[]).map((x:any)=>[x.first_owner_id,x]));
  const workspaceMap=new Map((workspaces||[]).map((x:any)=>[x.owner_id,x.payload]));
  const now=Date.now();
  const list=authUsers.map((u:any)=>{
   const sub:any=subMap.get(u.id)||{};
   const entitlement=plans[sub.plan]||null;
   const expired=!!sub.period_end&&new Date(sub.period_end).getTime()<=now;
   return {id:u.id,email:u.email||"",created_at:u.created_at,last_sign_in_at:u.last_sign_in_at,...sub,display_status:expired&&sub.status==="active"?"expired":sub.status,usage:usageMap.get(u.id)||null,trial_claim:claimMap.get(u.id)||null,customer_count:customerCount(workspaceMap.get(u.id)),voice_limit_minutes:entitlement?.voiceMinutes??0,customer_limit:entitlement?.customerLimit??null,has_subscription:Boolean(sub.owner_id),has_entitlement:Boolean(entitlement)};
  });
  return NextResponse.json({users:list,payments,stats:{totalUsers:list.length,pendingPayments:(payments||[]).filter((p:any)=>p.status==="pending").length,activePlans:list.filter((u:any)=>u.plan&&u.plan!=="trial"&&u.status==="active"&&new Date(u.period_end).getTime()>now).length,voiceSeconds:[...usageMap.values()].reduce((n:any,x:any)=>n+(x.voice_seconds||0),0),aiCalls:[...usageMap.values()].reduce((n:any,x:any)=>n+(x.ai_calls||0),0)}});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Could not load admin data"},{status:500})}
}

export async function POST(req:NextRequest){
 if(!isAdmin(req))return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const b=await req.json();const action=String(b.action||"");const userId=String(b.userId||"");
  if(action==="review_payment"){
   const rows=await sb("payment_requests?id=eq."+encodeURIComponent(String(b.paymentId))+"&select=*");const p=rows?.[0];if(!p||p.status!=="pending")return NextResponse.json({error:"Payment is no longer pending."},{status:400});
   const status=b.decision==="approve"?"approved":"rejected";
   await sb("payment_requests?id=eq."+p.id,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status,reviewed_at:new Date().toISOString()})});
   if(status==="approved"){if(!plans[p.plan])return NextResponse.json({error:"Payment has an invalid plan."},{status:400});const end=new Date();end.setDate(end.getDate()+plans[p.plan].days);await upsertSubscription(p.owner_id,{plan:p.plan,status:"active",period_start:new Date().toISOString(),period_end:end.toISOString(),bonus_voice_seconds:0})}
  }else if(action==="change_plan"){
   if(!plans[b.plan])return NextResponse.json({error:"Invalid plan"},{status:400});const end=new Date();end.setDate(end.getDate()+plans[b.plan].days);await upsertSubscription(userId,{plan:b.plan,status:"active",period_start:new Date().toISOString(),period_end:end.toISOString(),bonus_voice_seconds:0});
  }else if(action==="add_voice"){
   const rows=await sb("subscriptions?owner_id=eq."+userId+"&select=bonus_voice_seconds,plan,status,period_start,period_end");if(!rows?.length)return NextResponse.json({error:"Assign a plan before adding bonus voice."},{status:400});const cur=rows[0]?.bonus_voice_seconds||0;const minutes=Math.max(0,Number(b.minutes)||0);await upsertSubscription(userId,{bonus_voice_seconds:cur+Math.round(minutes*60)});
  }else if(action==="extend"){
   const rows=await sb("subscriptions?owner_id=eq."+userId+"&select=period_end,plan");if(!rows?.length||!plans[rows[0]?.plan])return NextResponse.json({error:"Assign a plan before extending access."},{status:400});const currentEnd=new Date(rows[0]?.period_end||0).getTime();const start=Number.isFinite(currentEnd)?Math.max(Date.now(),currentEnd):Date.now();const end=new Date(start+(Math.max(1,Number(b.days)||30)*86400000));await upsertSubscription(userId,{period_end:end.toISOString(),status:"active"});
  }else if(action==="status"){
   const rows=await sb("subscriptions?owner_id=eq."+userId+"&select=owner_id");if(!rows?.length)return NextResponse.json({error:"This user has no subscription to suspend or reactivate."},{status:400});await upsertSubscription(userId,{status:b.status==="suspended"?"suspended":"active"});
  }else if(action==="grant_trial"){
   const end=new Date(Date.now()+30*86400000);await upsertSubscription(userId,{plan:"trial",status:"active",period_start:new Date().toISOString(),period_end:end.toISOString(),bonus_voice_seconds:0});
  }else if(action==="delete_user"){
   if(!userId)return NextResponse.json({error:"User is required"},{status:400});
   const authUsers=await users();const target=authUsers.find((u:any)=>u.id===userId);if(!target)return NextResponse.json({error:"User not found"},{status:404});
   if(String(target.email||"").toLowerCase()==="zorivoworks@gmail.com")return NextResponse.json({error:"The owner account cannot be deleted from Admin."},{status:400});
   await deleteAuthUser(userId);
  }else return NextResponse.json({error:"Unknown action"},{status:400});
  return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Admin action failed"},{status:500})}
}
