import { NextRequest, NextResponse } from "next/server";

function cfg(){return{base:process.env.NEXT_PUBLIC_SUPABASE_URL||"",service:process.env.SUPABASE_SERVICE_ROLE_KEY||"",resend:process.env.RESEND_API_KEY||"",from:process.env.TRIAL_EMAIL_FROM||"Pakki Baat <onboarding@resend.dev>",appUrl:process.env.NEXT_PUBLIC_APP_URL||""}}
async function sb(path:string,init:RequestInit={}){const{base,service}=cfg();const r=await fetch(base+"/rest/v1/"+path,{...init,headers:{apikey:service,Authorization:"Bearer "+service,"Content-Type":"application/json",...(init.headers||{})},cache:"no-store"});const t=await r.text();if(!r.ok)throw new Error(t||"Database request failed");return t?JSON.parse(t):null}
async function authUsers(){const{base,service}=cfg();const r=await fetch(base+"/auth/v1/admin/users?per_page=1000",{headers:{apikey:service,Authorization:"Bearer "+service},cache:"no-store"});if(!r.ok)throw new Error("Could not load users");return(await r.json()).users||[]}

export async function GET(req:NextRequest){
  const secret=process.env.CRON_SECRET||"";
  if(secret&&req.headers.get("authorization")!=="Bearer "+secret)return NextResponse.json({error:"Unauthorized"},{status:401});
  const{base,service,resend,from,appUrl}=cfg();
  if(!base||!service)return NextResponse.json({error:"Supabase server configuration missing"},{status:503});
  if(!resend||!appUrl)return NextResponse.json({ok:false,error:"RESEND_API_KEY and NEXT_PUBLIC_APP_URL must be configured",sent:0},{status:503});
  try{
    const now=new Date();
    const upper=new Date(now.getTime()+3*86400000).toISOString();
    const lower=new Date(now.getTime()+1*86400000).toISOString();
    const trials=await sb("subscriptions?plan=eq.trial&status=eq.active&period_end=gt."+encodeURIComponent(lower)+"&period_end=lte."+encodeURIComponent(upper)+"&select=owner_id,period_end");
    const users=await authUsers();const emailMap=new Map(users.map((u:any)=>[u.id,u.email]));
    let sent=0;
    for(const sub of trials||[]){
      const prior=await sb("trial_expiry_email_log?owner_id=eq."+sub.owner_id+"&period_end=eq."+encodeURIComponent(sub.period_end)+"&select=owner_id");
      if(prior?.length)continue;
      const to=emailMap.get(sub.owner_id);if(!to)continue;
      const endDate=new Date(sub.period_end).toLocaleDateString("en-IN",{day:"numeric",month:"long",year:"numeric",timeZone:"Asia/Kolkata"});
      const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:"Bearer "+resend,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject:"Your Pakki Baat free trial ends in 2 days",html:'<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17352c"><h2>Your free trial ends soon</h2><p>Your 30-day Pakki Baat trial ends on <strong>'+endDate+'</strong>.</p><p>Your Hisaab and customer data will stay safe. Choose a plan to keep adding customers and using voice/AI without interruption.</p><p><a href="'+appUrl+'" style="display:inline-block;background:#2d8069;color:#fff;padding:11px 16px;border-radius:9px;text-decoration:none;font-weight:700">View plans</a></p><p style="color:#708078;font-size:12px">Pakki Baat · by Zorivo</p></div>'})});
      if(!mail.ok)continue;
      await sb("trial_expiry_email_log",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({owner_id:sub.owner_id,period_end:sub.period_end})});
      sent++;
    }
    return NextResponse.json({ok:true,sent});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Trial reminder failed"},{status:500})}
}
