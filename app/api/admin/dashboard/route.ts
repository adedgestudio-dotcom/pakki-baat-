import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
const plans:any={trial:{days:30,voice:0},basic:{days:30,voice:0},smart:{days:30,voice:0},business:{days:30,voice:0}};
function env(){return {base:process.env.NEXT_PUBLIC_SUPABASE_URL||"",service:process.env.SUPABASE_SERVICE_ROLE_KEY||""}}
async function sb(path:string,init:RequestInit={}){const {base,service}=env();const r=await fetch(base+"/rest/v1/"+path,{...init,headers:{apikey:service,Authorization:"Bearer "+service,"Content-Type":"application/json",...(init.headers||{})},cache:"no-store"});const t=await r.text();if(!r.ok)throw new Error(t||"Database request failed");return t?JSON.parse(t):null}
async function users(){const {base,service}=env();const r=await fetch(base+"/auth/v1/admin/users?per_page=1000",{headers:{apikey:service,Authorization:"Bearer "+service},cache:"no-store"});if(!r.ok)throw new Error("Could not load users");return (await r.json()).users||[]}
export async function GET(req:NextRequest){
 if(!isAdmin(req))return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const [authUsers,subs,usage,payments,claims]=await Promise.all([users(),sb("subscriptions?select=*"),sb("ai_monthly_usage?select=owner_id,period_month,voice_seconds,ai_calls&order=period_month.desc"),sb("payment_requests?select=*&order=submitted_at.desc"),sb("trial_claims?select=first_owner_id,claimed_at")]);
  const latest=new Map();for(const x of usage||[])if(!latest.has(x.owner_id))latest.set(x.owner_id,x);
  const subMap=new Map((subs||[]).map((x:any)=>[x.owner_id,x]));
  const claimMap=new Map((claims||[]).map((x:any)=>[x.first_owner_id,x]));
  const list=authUsers.map((u:any)=>({id:u.id,email:u.email||"",created_at:u.created_at,last_sign_in_at:u.last_sign_in_at,...(subMap.get(u.id)||{}),usage:latest.get(u.id)||null,trial_claim:claimMap.get(u.id)||null}));
  const now=Date.now();return NextResponse.json({users:list,payments,stats:{totalUsers:list.length,pendingPayments:(payments||[]).filter((p:any)=>p.status==="pending").length,activePlans:list.filter((u:any)=>u.plan&&u.plan!=="trial"&&u.status==="active"&&new Date(u.period_end).getTime()>now).length,voiceSeconds:[...latest.values()].reduce((n:any,x:any)=>n+(x.voice_seconds||0),0)}});
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
   if(status==="approved"){const end=new Date();end.setDate(end.getDate()+30);await sb("subscriptions?owner_id=eq."+p.owner_id,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({plan:p.plan,status:"active",period_start:new Date().toISOString(),period_end:end.toISOString(),bonus_voice_seconds:0,updated_at:new Date().toISOString()})})}
  }else if(action==="change_plan"){
   if(!plans[b.plan])return NextResponse.json({error:"Invalid plan"},{status:400});const end=new Date();end.setDate(end.getDate()+plans[b.plan].days);await sb("subscriptions?owner_id=eq."+userId,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({plan:b.plan,status:"active",period_start:new Date().toISOString(),period_end:end.toISOString(),updated_at:new Date().toISOString()})});
  }else if(action==="add_voice"){
   const rows=await sb("subscriptions?owner_id=eq."+userId+"&select=bonus_voice_seconds");const cur=rows?.[0]?.bonus_voice_seconds||0;const minutes=Math.max(0,Number(b.minutes)||0);await sb("subscriptions?owner_id=eq."+userId,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({bonus_voice_seconds:cur+Math.round(minutes*60),updated_at:new Date().toISOString()})});
  }else if(action==="extend"){
   const rows=await sb("subscriptions?owner_id=eq."+userId+"&select=period_end");const start=Math.max(Date.now(),new Date(rows?.[0]?.period_end||0).getTime());const end=new Date(start+(Math.max(1,Number(b.days)||30)*86400000));await sb("subscriptions?owner_id=eq."+userId,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({period_end:end.toISOString(),status:"active",updated_at:new Date().toISOString()})});
  }else if(action==="status"){
   await sb("subscriptions?owner_id=eq."+userId,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({status:b.status==="suspended"?"suspended":"active",updated_at:new Date().toISOString()})});
  }else if(action==="grant_trial"){
   const end=new Date(Date.now()+30*86400000);await sb("subscriptions?owner_id=eq."+userId,{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({plan:"trial",status:"active",period_start:new Date().toISOString(),period_end:end.toISOString(),bonus_voice_seconds:0,updated_at:new Date().toISOString()})});
  }else return NextResponse.json({error:"Unknown action"},{status:400});
  return NextResponse.json({ok:true});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Admin action failed"},{status:500})}
}
