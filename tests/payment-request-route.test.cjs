/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const ts = require("typescript");
const { createHash } = require("node:crypto");

class FakeFile { constructor(bytes, type="image/png") { this.bytes=Buffer.from(bytes); this.size=this.bytes.length; this.type=type; } async arrayBuffer(){ return this.bytes; } }
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body,text:async()=>typeof body==="string"?body:JSON.stringify(body)});

function routeHarness() {
  const source=fs.readFileSync(path.join(__dirname,"../app/api/payment-request/route.ts"),"utf8");
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const requests=[]; let reserved=false, stored=false, successfulUploads=0;
  const testModule={exports:{}};
  const fetch=async(url,init={})=>{
    requests.push({url,method:init.method||"GET",body:init.body});
    if(url.endsWith("/auth/v1/user")) return response({id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",email:"qa@example.test"});
    if(url.includes("reserve_subscription_payment_request")) { const body=JSON.parse(init.body); if(body.p_request_fingerprint==="conflict")return response("PAYMENT_REQUEST_IDEMPOTENCY_CONFLICT",400); const first=!reserved; reserved=true; return response([{id:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",proof_path:body.p_proof_path,status:"pending",created:first}]); }
    if(url.includes("/storage/v1/object/")) { if(init.method==="HEAD")return response(null,stored?200:404); if(init.method==="POST"){if(stored)return response(null,409);stored=true;successfulUploads++;return response(null,200);} }
    throw new Error("Unexpected request "+url);
  };
  const mockedRequire=(name)=>{
    if(name==="next/server") return {NextResponse:{json:(body,init={})=>({body,status:init.status||200,json:async()=>body})}};
    if(name==="crypto") return {createHash};
    return require(name);
  };
  vm.runInNewContext(compiled,{module:testModule,exports:testModule.exports,require:mockedRequire,process:{env:{NEXT_PUBLIC_SUPABASE_URL:"https://staging.invalid",NEXT_PUBLIC_SUPABASE_ANON_KEY:"anon",SUPABASE_SERVICE_ROLE_KEY:"service"}},fetch,Buffer,File:FakeFile,console});
  const request=(key,proof=new FakeFile("image"))=>({headers:{get:(name)=>name==="authorization"?"Bearer token":null},formData:async()=>({get:(name)=>({plan:"Basic",transactionRef:"QA-REF",idempotencyKey:key,proof}[name]??null)})});
  return {post:testModule.exports.POST,request,requests,get successfulUploads(){return successfulUploads;}};
}

test("identical concurrent replays reserve one request and one deterministic proof",async()=>{
  const h=routeHarness(),key="11111111-1111-4111-8111-111111111111";
  const [a,b]=await Promise.all([h.post(h.request(key)),h.post(h.request(key))]);
  assert.equal(a.status,200); assert.equal(b.status,200);
  assert.equal(h.requests.filter(x=>x.url.includes("reserve_subscription_payment_request")).length,2);
  assert.equal(h.successfulUploads,1);
});

test("client route forwards one stable idempotency key to the database reservation",async()=>{
  const h=routeHarness(),key="22222222-2222-4222-8222-222222222222";
  await h.post(h.request(key));
  const reservation=h.requests.find(x=>x.url.includes("reserve_subscription_payment_request"));
  assert.equal(JSON.parse(reservation.body).p_idempotency_key,key);
});
