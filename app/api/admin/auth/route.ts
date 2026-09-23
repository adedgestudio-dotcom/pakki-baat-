import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { clearAdminCookie, isAdmin, setAdminCookie } from "@/lib/admin-auth";

export async function GET(request:NextRequest){return NextResponse.json({ok:isAdmin(request)},{status:isAdmin(request)?200:401})}
export async function POST(request:NextRequest){
  const expected=process.env.ADMIN_PIN?.trim();
  if(!expected) return NextResponse.json({error:"Admin PIN is not configured"},{status:503});
  const body=await request.json().catch(()=>({}));
  const supplied=String(body?.pin||"").trim();
  const a=Buffer.from(supplied),b=Buffer.from(expected);
  if(!(a.length===b.length&&timingSafeEqual(a,b))) return NextResponse.json({error:"Incorrect PIN. Please try again."},{status:401});
  const response=NextResponse.json({ok:true}); setAdminCookie(response); return response;
}
export async function DELETE(){const response=NextResponse.json({ok:true});clearAdminCookie(response);return response}
