import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";

export async function GET(request:NextRequest){
  if(!isAdmin(request)) return NextResponse.json({error:"Unauthorized"},{status:401});
  const path=request.nextUrl.searchParams.get("path")||"";
  if(!path || path.includes("..")) return NextResponse.json({error:"Invalid proof path"},{status:400});
  const base=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY||"";
  if(!base||!service) return NextResponse.json({error:"Storage is not configured"},{status:503});
  const r=await fetch(base+"/storage/v1/object/payment-proofs/"+path.split("/").map(encodeURIComponent).join("/"),{headers:{apikey:service,Authorization:"Bearer "+service},cache:"no-store"});
  if(!r.ok) return NextResponse.json({error:"Payment proof not found"},{status:r.status===404?404:500});
  const bytes=await r.arrayBuffer();
  return new NextResponse(bytes,{status:200,headers:{"Content-Type":r.headers.get("content-type")||"image/jpeg","Cache-Control":"private, no-store","Content-Disposition":"inline"}});
}
