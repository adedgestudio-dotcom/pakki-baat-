/* eslint-disable @typescript-eslint/no-require-imports */
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const ts=require("typescript");
const vm=require("node:vm");

function loadCron(secret){
  const source=fs.readFileSync(path.join(__dirname,"../app/api/cron/trial-expiry/route.ts"),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const testModule={exports:{}},calls=[];
  const fetch=async(url,init={})=>{calls.push({url,init});return {ok:true,text:async()=>"{}",json:async()=>[]};};
  vm.runInNewContext(code,{module:testModule,exports:testModule.exports,require:(name)=>name==="next/server"?{NextResponse:{json:(body,init={})=>({body,status:init.status||200})}}:require(name),process:{env:{CRON_SECRET:secret,NEXT_PUBLIC_SUPABASE_URL:"https://staging.invalid",SUPABASE_SERVICE_ROLE_KEY:"service"}},fetch,console,Date,Map,encodeURIComponent});
  return {get:testModule.exports.GET,calls};
}
const request=(authorization)=>({headers:{get:(name)=>name==="authorization"?authorization:null}});

test("cron fails closed when CRON_SECRET is missing",async()=>{
  const h=loadCron(""); const result=await h.get(request(null));
  assert.equal(result.status,401); assert.equal(h.calls.length,0);
});
test("cron rejects an incorrect secret before lifecycle work",async()=>{
  const h=loadCron("expected"); const result=await h.get(request("Bearer wrong"));
  assert.equal(result.status,401); assert.equal(h.calls.length,0);
});
test("cron accepts the matching secret and invokes the lifecycle RPC",async()=>{
  const h=loadCron("expected"); const result=await h.get(request("Bearer expected"));
  assert.equal(result.status,200); assert.equal(h.calls[0].url.endsWith("/rest/v1/rpc/apply_due_pending_plans"),true);
});
