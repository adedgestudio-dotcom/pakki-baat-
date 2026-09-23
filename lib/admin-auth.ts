import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

const COOKIE="pakki_admin";
function secret(){return process.env.ADMIN_SESSION_SECRET?.trim()||process.env.ADMIN_PIN?.trim()||""}
function signature(){return createHmac("sha256",secret()).update("pakki-baat-admin-v1").digest("hex")}
export function isAdmin(request:NextRequest){
  const got=request.cookies.get(COOKIE)?.value||"", expected=signature();
  if(!got||!expected||got.length!==expected.length) return false;
  return timingSafeEqual(Buffer.from(got),Buffer.from(expected));
}
export function setAdminCookie(response:NextResponse){
  response.cookies.set(COOKIE,signature(),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:"/",maxAge:60*60*8});
}
export function clearAdminCookie(response:NextResponse){response.cookies.set(COOKIE,"",{httpOnly:true,path:"/",maxAge:0})}
