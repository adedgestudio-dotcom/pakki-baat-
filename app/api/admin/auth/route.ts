import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { clearAdminCookie, isAdmin, setAdminCookie } from "@/lib/admin-auth";

const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const failedAttempts = new Map<string, number[]>();

export async function GET(request:NextRequest){return NextResponse.json({ok:isAdmin(request)},{status:isAdmin(request)?200:401})}
export async function POST(request:NextRequest){
  const expected=process.env.ADMIN_PIN?.trim();
  const qaExpected=process.env.VERCEL_ENV==="preview"||process.env.VERCEL_ENV==="development"?process.env.QA_ADMIN_PIN?.trim():undefined;
  if(!expected && !qaExpected) return NextResponse.json({error:"Admin PIN is not configured"},{status:503});
  const body=await request.json().catch(()=>({}));
  const supplied=String(body?.pin||"").trim();
  // Only trust the platform-provided IP header on Vercel; otherwise share a limit.
  const ip=process.env.VERCEL==="1" ? request.headers.get("x-real-ip")?.trim() || "unknown" : "unknown";
  const now=Date.now();
  for(const [key,timestamps] of failedAttempts){
    const recent=timestamps.filter(timestamp=>now-timestamp<ATTEMPT_WINDOW_MS);
    if(recent.length) failedAttempts.set(key,recent); else failedAttempts.delete(key);
  }
  const attempts=failedAttempts.get(ip)||[];
  const locked=()=>NextResponse.json({error:"Too many attempts. Try again later."},{status:429,headers:{"Retry-After":String(Math.max(1,Math.ceil((ATTEMPT_WINDOW_MS-(now-attempts[0]))/1000)))}});
  if(attempts.length>=MAX_FAILED_ATTEMPTS) return locked();
  const matches=(candidate:string|undefined)=>{
    if(!candidate) return false;
    const a=Buffer.from(supplied),b=Buffer.from(candidate);
    return a.length===b.length&&timingSafeEqual(a,b);
  };
  if(!matches(expected)&&!matches(qaExpected)){
    attempts.push(now);
    failedAttempts.set(ip,attempts);
    if(attempts.length>=MAX_FAILED_ATTEMPTS) return locked();
    return NextResponse.json({error:"Incorrect PIN. Please try again."},{status:401});
  }
  failedAttempts.delete(ip);
  const response=NextResponse.json({ok:true}); setAdminCookie(response); return response;
}
export async function DELETE(){const response=NextResponse.json({ok:true});clearAdminCookie(response);return response}
