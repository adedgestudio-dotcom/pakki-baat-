// Staging-only integration tests. Credentials are read locally and never printed.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),vm=require('node:vm'),ts=require('typescript'),{webcrypto,createHash}=require('node:crypto');
const root=path.join(__dirname,'..');
const cfg=Object.fromEntries(fs.readFileSync(path.join(root,'.env.staging.local'),'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]}));
const base=cfg.STAGING_SUPABASE_URL,a='740411d2-a2c9-4dd6-84ba-8679514d28fb',b='0b10a8ff-425b-4dc2-9663-d0bfe39e3364',bucket='hisaab-entry-photos';
function load(file,deps={}){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,require:n=>deps[n],fetch,Error,Request,Response,File,FormData,URL,URLSearchParams,AbortSignal,Uint8Array,crypto:webcrypto,String,Number});return m.exports;}
const v=load('lib/entry-photo.ts'),server=load('lib/entry-photo-server.ts',{'./entry-photo':v});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
let passed=0;const pass=(name,evidence={})=>{passed++;console.log(JSON.stringify({status:'PASS',name,evidence}));};
async function api(route,body,token,admin=false,method){const key=admin?cfg.STAGING_SERVICE_ROLE_KEY:cfg.STAGING_ANON_KEY,r=await fetch(base+route,{method:method||(body?'POST':'GET'),headers:{apikey:key,Authorization:'Bearer '+(token||key),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(route+' '+r.status);return data;}
function request(token,entryId,file=new File([png],'photo.png',{type:'image/png'})){const form=new FormData();form.set('entryId',entryId);form.set('photo',file);return new Request('http://local/api/hisaab-photo',{method:'POST',headers:{Authorization:'Bearer '+token},body:form});}
const get=(token,id)=>new Request('http://local/api/hisaab-photo?entryId='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+token}});
(async()=>{
 assert.equal(new URL(base).hostname,'jplxtqiryjnsdruqxgbh.supabase.co');
 const sa=await api('/auth/v1/token?grant_type=password',{email:cfg.STAGING_TEST_EMAIL,password:cfg.STAGING_TEST_PASSWORD});assert.equal(sa.user.id,a);
 const existing=await api('/auth/v1/admin/users/'+b,null,null,true);assert.equal(existing.email,'pakkibaat.restore.drill.20261017@example.com');
 const link=await api('/auth/v1/admin/generate_link',{type:'magiclink',email:existing.email},null,true);assert.equal(link.id,b);
 const sb=await api('/auth/v1/verify',{type:'magiclink',token_hash:link.hashed_token});assert.equal(sb.user.id,b);
 const auth=sa.access_token,before=await api('/rest/v1/workspaces?select=payload,revision',null,auth),beforeLedger=await api('/rest/v1/hisaab_ledger_transactions?select=id&order=id',null,auth);
 const photos=await api('/rest/v1/hisaab_entry_photos?select=entry_id',null,auth),available=before[0].payload.jobs.filter(j=>!photos.some(p=>p.entry_id===j.id));assert.ok(available.length>=3,'three existing synthetic entries without photos required; never overwrite fixtures');
 const handlers=server.createEntryPhotoHandlers(()=>({base,key:cfg.STAGING_ANON_KEY}));
 let response=await handlers.POST(request(auth,available[0].id));assert.equal(response.status,201,await response.text());pass('authenticated private photo upload',{entryId:available[0].id});
 response=await handlers.GET(get(auth,available[0].id));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);pass('authenticated photo bytes and private cache headers');
 const rows=await api('/rest/v1/hisaab_entry_photos?entry_id=eq.'+available[0].id+'&select=*',null,auth);const row=rows[0];assert.equal(row.owner_id,a);
 response=await handlers.GET(get(sb.access_token,available[0].id));assert.equal(response.status,404);pass('other authenticated account cannot read attachment metadata');
 const forbidden=await fetch(base+'/storage/v1/object/authenticated/'+bucket+'/'+row.object_path,{headers:{apikey:cfg.STAGING_ANON_KEY,Authorization:'Bearer '+sb.access_token}});assert.ok(!forbidden.ok);pass('other authenticated account cannot download object',{status:forbidden.status});
 const anonymous=await fetch(base+'/storage/v1/object/public/'+bucket+'/'+row.object_path);assert.ok(!anonymous.ok);pass('public URL cannot expose the private photo',{status:anonymous.status});
 const cross=await fetch(base+'/rest/v1/hisaab_entry_photos',{method:'POST',headers:{apikey:cfg.STAGING_ANON_KEY,Authorization:'Bearer '+sb.access_token,'Content-Type':'application/json'},body:JSON.stringify({owner_id:a,entry_id:available[0].id,object_path:row.object_path,content_type:'image/png',byte_size:png.length})});assert.ok(!cross.ok);pass('cross-account metadata write denied',{status:cross.status});
 response=await handlers.POST(request(auth,available[0].id));assert.equal(response.status,409);pass('second photo rejected for the same entry');
 const invalid=await handlers.POST(request(auth,available[1].id,new File(['<svg/>'],'bad.svg',{type:'image/svg+xml'})));assert.equal(invalid.status,415);pass('unsupported type rejected before storage');
 const oversized=await handlers.POST(request(auth,available[1].id,new File([new Uint8Array(v.PHOTO_MAX_BYTES+1)],'large.png',{type:'image/png'})));assert.equal(oversized.status,413);pass('oversized upload rejected');
 let lost=false;
 const recovered=server.createEntryPhotoHandlers(()=>({base,key:cfg.STAGING_ANON_KEY}),async(url,init)=>{const r=await fetch(url,init);if(!lost&&url.endsWith('/rest/v1/hisaab_entry_photos')&&init.method==='POST'&&r.ok){lost=true;await r.body?.cancel();throw Error('simulated lost metadata acknowledgment');}return r;});
 response=await recovered.POST(request(auth,available[1].id));assert.equal(response.status,201,await response.text());assert.equal(lost,true);pass('lost real metadata acknowledgment recovers without losing attachment');
 const concurrent=await Promise.all([handlers.POST(request(auth,available[2].id)),handlers.POST(request(auth,available[2].id))]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[201,409]);pass('concurrent authenticated uploads retain exactly one attachment');
 const after=await api('/rest/v1/workspaces?select=payload,revision',null,auth),afterLedger=await api('/rest/v1/hisaab_ledger_transactions?select=id&order=id',null,auth);assert.deepEqual(after,before);assert.deepEqual(afterLedger,beforeLedger);pass('photo operations leave financial payload, revision and ledger unchanged',{revision:before[0].revision,workspaceSha256:createHash('sha256').update(JSON.stringify(before)).digest('hex')});
 console.log(JSON.stringify({passed,failed:0,photoEntryIds:available.slice(0,3).map(j=>j.id)}));
})().catch(e=>{console.error(JSON.stringify({status:'FAIL',message:e.message,stack:e.stack?.split('\n').slice(0,4)}));process.exitCode=1;});
