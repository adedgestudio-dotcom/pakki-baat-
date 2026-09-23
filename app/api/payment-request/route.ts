import { NextRequest, NextResponse } from "next/server";

const allowedPlans:Record<string,number>={Basic:99,Smart:199,Business:349};

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
  const proof=form.get("proof");
  if(!(plan in allowedPlans)) return NextResponse.json({error:"Please choose a valid plan."},{status:400});
  if(!transactionRef && !(proof instanceof File && proof.size>0)) return NextResponse.json({error:"Upload a payment screenshot or enter the transaction ID."},{status:400});

  let proofPath:string|null=null;
  if(proof instanceof File && proof.size>0){
    if(!proof.type.startsWith("image/")) return NextResponse.json({error:"Payment proof must be an image."},{status:400});
    if(proof.size>5*1024*1024) return NextResponse.json({error:"Screenshot must be under 5 MB."},{status:400});
    const ext=(proof.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").toLowerCase()||"jpg";
    proofPath=`${user.id}/${Date.now()}.${ext}`;
    const bytes=Buffer.from(await proof.arrayBuffer());
    const upload=await fetch(`${base}/storage/v1/object/payment-proofs/${proofPath}`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":proof.type,"x-upsert":"false"},body:bytes});
    if(!upload.ok) return NextResponse.json({error:"Could not upload screenshot. Please try again."},{status:500});
  }

  const insert=await fetch(`${base}/rest/v1/payment_requests`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({owner_id:user.id,email:user.email||null,plan:plan.toLowerCase(),amount:allowedPlans[plan],transaction_ref:transactionRef||null,proof_path:proofPath,status:"pending"})});
  if(!insert.ok) return NextResponse.json({error:"Could not save payment request. Please try again."},{status:500});
  return NextResponse.json({ok:true});
}
