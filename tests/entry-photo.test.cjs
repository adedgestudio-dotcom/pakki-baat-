const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {webcrypto}=require('node:crypto');
const React=require('react');
function load(file,deps={},env=process.env){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,{module:m,exports:m.exports,require:n=>deps[n],process:{env},React,Error,Request,Response,File,FormData,URL,URLSearchParams,AbortSignal,Uint8Array,crypto:webcrypto,String,Number});return m.exports;}
const validation=load('lib/entry-photo.ts'),{createEntryPhotoHandlers}=load('lib/entry-photo-server.ts',{'./entry-photo':validation});
const owner='740411d2-a2c9-4dd6-84ba-8679514d28fb',png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function uploadRequest(extra){const f=new FormData();f.set('entryId','entry-a');f.append('photo',new File([png],'photo.png',{type:'image/png'}));if(extra)f.append('photo',new File([png],'extra.png',{type:'image/png'}));return new Request('http://local/api/hisaab-photo',{method:'POST',headers:{Authorization:'Bearer test-owner'},body:f});}
function harness(options={}){
 const state={row:options.row||null,objects:new Map(),deleted:[],paths:[],metadataCalls:0};
 const api=createEntryPhotoHandlers(()=>({base:'https://staging.example',key:'public-key'}),async(url,init)=>{
  const p=new URL(url).pathname;state.paths.push(p);
  if(p==='/auth/v1/user')return Response.json({id:owner});
  if(p==='/rest/v1/hisaab_entry_photos'&&init.method==='POST'){
   const row=JSON.parse(init.body);state.metadataCalls++;
   if(options.rejectMetadata)return Response.json({}, {status:403});
   if(state.row)return Response.json({}, {status:409});
   state.row=row;
   if(options.lostResponse)throw Error('lost acknowledgment');
   return Response.json({}, {status:201});
  }
  if(p==='/rest/v1/hisaab_entry_photos'){
   if(options.uncertain&&state.metadataCalls)throw Error('lookup unavailable');
   return Response.json(state.row?[state.row]:[]);
  }
  if(p.startsWith('/storage/v1/object/authenticated/'))return new Response(png);
  if(init.method==='DELETE'){const f=JSON.parse(init.body).prefixes;state.deleted.push(...f);f.forEach(k=>state.objects.delete(k));return Response.json({});}
  if(p.startsWith('/storage/v1/object/')){const key=p.split('/').slice(5).join('/');state.objects.set(key,init.body);return Response.json({}, {status:201});}
  throw Error(p);
 });return {api,state};
}
test('photo validation accepts PNG, JPEG and WebP signatures',()=>{
 for(const [type,bytes]of[['image/png',png],['image/jpeg',new Uint8Array([255,216,255,0])],['image/webp',new TextEncoder().encode('RIFFxxxxWEBP')]])validation.validatePhoto({type,size:bytes.length},bytes);
});
test('photo validation rejects SVG, spoofed MIME, empty and oversized files',()=>{
 for(const file of[{type:'image/svg+xml',size:10},{type:'image/png',size:0},{type:'image/jpeg',size:validation.PHOTO_MAX_BYTES+1}])assert.throws(()=>validation.validatePhoto(file));
 assert.throws(()=>validation.validatePhoto({type:'image/jpeg',size:png.length},png));
});
test('multipart reader accepts exactly one photo and rejects multiple photos',async()=>{
 assert.equal((await validation.readPhotoForm(uploadRequest())).entryId,'entry-a');
 await assert.rejects(()=>validation.readPhotoForm(uploadRequest(true)),/exactly one/);
});
test('entry and body boundaries reject missing IDs and oversized declared uploads',async()=>{
 for(const id of[null,'', 'x'.repeat(201),'a\u0000b'])assert.throws(()=>validation.photoEntryId(id));
 const r=new Request('http://local',{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=x','Content-Length':String(validation.PHOTO_MAX_BYTES+65537)},body:'x'});
 await assert.rejects(()=>validation.readPhotoForm(r),/too large/);
});
test('unauthenticated requests fail before storage or database access',async()=>{
 const h=harness();assert.equal((await h.api.GET(new Request('http://local/?entryId=entry-a'))).status,401);assert.equal(h.state.paths.length,0);
});
test('private download requires owner authentication and disables caching',async()=>{
 const h=harness({row:{object_path:owner+'/11111111-1111-4111-8111-111111111111.png',content_type:'image/png',byte_size:png.length}});
 const r=await h.api.GET(new Request('http://local/?entryId=entry-a',{headers:{Authorization:'Bearer test-owner'}}));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('vary'),'Authorization');assert.deepEqual(Buffer.from(await r.arrayBuffer()),png);
});
test('missing photo returns 404 without creating an attachment',async()=>{
 const h=harness();assert.equal((await h.api.GET(new Request('http://local/?entryId=entry-a',{headers:{Authorization:'Bearer test-owner'}}))).status,404);assert.equal(h.state.metadataCalls,0);
});
test('upload links one immutable owner-scoped object without any financial endpoint',async()=>{
 const h=harness();assert.equal((await h.api.POST(uploadRequest())).status,201);assert.equal(h.state.row.owner_id,owner);assert.equal(h.state.row.entry_id,'entry-a');assert.ok(h.state.row.object_path.startsWith(owner+'/'));assert.equal(h.state.objects.size,1);assert.ok(h.state.paths.every(p=>!p.includes('workspaces')&&!p.includes('ledger')));
});
test('existing photo blocks another upload before writing an object',async()=>{
 const h=harness({row:{object_path:'existing'}});assert.equal((await h.api.POST(uploadRequest())).status,409);assert.equal(h.state.objects.size,0);
});
test('known metadata rejection removes only the failed unlinked upload',async()=>{
 const h=harness({rejectMetadata:true});assert.equal((await h.api.POST(uploadRequest())).status,403);assert.equal(h.state.deleted.length,1);assert.equal(h.state.objects.size,0);assert.equal(h.state.row,null);
});
test('lost metadata acknowledgment recovers the committed photo without deleting it',async()=>{
 const h=harness({lostResponse:true});assert.equal((await h.api.POST(uploadRequest())).status,201);assert.equal(h.state.deleted.length,0);assert.equal(h.state.objects.size,1);
});
test('uncertain acknowledgment never deletes a potentially linked photo',async()=>{
 const h=harness({lostResponse:true,uncertain:true});assert.equal((await h.api.POST(uploadRequest())).status,503);assert.equal(h.state.deleted.length,0);assert.ok(h.state.row);
});
test('concurrent uploads cannot create two photo metadata records',async()=>{
 const h=harness();const results=await Promise.all([h.api.POST(uploadRequest()),h.api.POST(uploadRequest())]);assert.deepEqual(results.map(x=>x.status).sort(),[201,409]);assert.equal(h.state.objects.size,1);
});
test('download rejects a metadata path outside the authenticated owner',async()=>{
 const h=harness({row:{object_path:'00000000-0000-4000-8000-000000000000/x.png',content_type:'image/png',byte_size:png.length}});assert.equal((await h.api.GET(new Request('http://local/?entryId=entry-a',{headers:{Authorization:'Bearer test-owner'}}))).status,503);
});
for(const [label,environment,base,allowed]of[
 ['isolated staging preview','preview','https://jplxtqiryjnsdruqxgbh.supabase.co',true],
 ['production with staging URL','production','https://jplxtqiryjnsdruqxgbh.supabase.co',false],
 ['preview with production URL','preview','https://uendrvpkyvfxnoxsalpu.supabase.co',false],
 ['unspecified environment',undefined,'https://jplxtqiryjnsdruqxgbh.supabase.co',false],
])test('QA login boundary: '+label,()=>{
 const Form=()=>null,page=load('app/qa-login/page.tsx',{'next/navigation':{notFound(){throw Error('QA_NOT_FOUND');}},'./qa-login-form':{default:Form}},{VERCEL_ENV:environment,NEXT_PUBLIC_SUPABASE_URL:base});
 assert.equal(page.dynamic,'force-dynamic');
 if(allowed)assert.equal(page.default().type,Form);else assert.throws(()=>page.default(),/QA_NOT_FOUND/);
});
