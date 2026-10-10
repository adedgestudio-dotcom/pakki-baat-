import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

const allowedPlans:Record<string,number>={Basic:99,Smart:179,Business:299};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fingerprint=(parts:Record<string,string>)=>createHash("sha256").update(JSON.stringify(parts)).digest("hex");

export async function POST(request:NextRequest){
  const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const auth=request.headers.get("authorization");
  if(!base||!publicKey||!service) return NextResponse.json({error:"Payment service is not configured."},{status:503});
  if(!auth?.startsWith("Bearer ")) return NextResponse.json({error:"Please sign in first."},{status:401});

  const userRes=await fetch(`${base}/auth/v1/user`,{headers:{apikey:publicKey,Authorization:auth}});
  if(!userRes.ok) return NextResponse.json({error:"Your sign-in has expired. Please sign in again."},{status:401});
  const user=await userRes.json();

  const form=await request.formData();
  const plan=String(form.get("plan")||"").replace(/\s+Plan$/i,"").trim();
  const transactionRef=String(form.get("transactionRef")||"").trim();
  const idempotencyKey=String(form.get("idempotencyKey")||"").trim();
  const proof=form.get("proof");
  if(!(plan in allowedPlans)) return NextResponse.json({error:"Please choose a valid plan."},{status:400});
  if(!transactionRef && !(proof instanceof File && proof.size>0)) return NextResponse.json({error:"Upload a payment screenshot or enter the transaction ID."},{status:400});
  if(!uuid.test(idempotencyKey)) return NextResponse.json({error:"Invalid payment submission. Please try again."},{status:400});
  if(transactionRef.length>80) return NextResponse.json({error:"Transaction ID must be 80 characters or fewer."},{status:400});

  let proofPath:string|null=null;
  let proofBytes:Buffer|null=null, proofType="";
  if(proof instanceof File && proof.size>0){
    if(!["image/jpeg","image/png","image/webp"].includes(proof.type)) return NextResponse.json({error:"Payment proof must be a JPG, PNG, or WebP image."},{status:400});
    if(proof.size>5*1024*1024) return NextResponse.json({error:"Screenshot must be under 5 MB."},{status:400});
    proofBytes=Buffer.from(await proof.arrayBuffer()); proofType=proof.type;
    const ext=proof.type==="image/png"?"png":proof.type==="image/webp"?"webp":"jpg";
    proofPath=`${user.id}/${idempotencyKey}.${ext}`;
  }

  const requestFingerprint=fingerprint({plan:plan.toLowerCase(),amount:String(allowedPlans[plan]),transactionRef,proofType,proofHash:proofBytes?createHash("sha256").update(proofBytes).digest("hex"):""});
  const reserve=await fetch(`${base}/rest/v1/rpc/reserve_subscription_payment_request`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify({p_owner_id:user.id,p_email:user.email||null,p_plan:plan.toLowerCase(),p_amount:allowedPlans[plan],p_transaction_ref:transactionRef||null,p_proof_path:proofPath,p_idempotency_key:idempotencyKey,p_request_fingerprint:requestFingerprint})});
  if(!reserve.ok){const detail=await reserve.text();if(detail.includes("PAYMENT_REQUEST_IDEMPOTENCY_CONFLICT"))return NextResponse.json({error:"This payment submission key was already used with different details."},{status:409});return NextResponse.json({error:"Could not submit payment. Please try again."},{status:500});}
  const rows=await reserve.json(),saved=Array.isArray(rows)?rows[0]:null;
  if(!saved?.id||saved.proof_path!==proofPath)return NextResponse.json({error:"Could not reserve payment submission. Please try again."},{status:500});
  if(proofBytes&&proofPath){
    const objectUrl=`${base}/storage/v1/object/payment-proofs/${proofPath}`;
    const exists=await fetch(objectUrl,{method:"HEAD",headers:{apikey:service,Authorization:`Bearer ${service}`}});
    if(exists.status===404){const upload=await fetch(objectUrl,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":proofType,"x-upsert":"false"},body:proofBytes as unknown as BodyInit});if(!upload.ok&&upload.status!==409)return NextResponse.json({error:"Payment request saved, but screenshot upload failed. Please retry with the same submission."},{status:503});}
    else if(!exists.ok)return NextResponse.json({error:"Could not verify payment screenshot. Please retry."},{status:503});
  }
  return NextResponse.json({ok:true,reused:!saved.created});
}
