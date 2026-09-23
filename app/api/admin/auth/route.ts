import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export async function POST(request:NextRequest){
  const expected=process.env.ADMIN_PIN?.trim();
  if(!expected) return NextResponse.json({error:"Admin PIN is not configured"},{status:503});
  const body=await request.json().catch(()=>({}));
  const supplied=String(body?.pin||"").trim();
  const a=Buffer.from(supplied), b=Buffer.from(expected);
  const valid=a.length===b.length && timingSafeEqual(a,b);
  if(!valid) return NextResponse.json({error:`PIN mismatch (entered ${supplied.length} digits; configured PIN has ${expected.length} digits)`},{status:401});
  return NextResponse.json({ok:true});
}
