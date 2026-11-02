const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/sarrah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const cfg=Object.fromEntries(fs.readFileSync(path.join(__dirname,'../.env.staging.local'),'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]}));
const base=cfg.STAGING_SUPABASE_URL,key='sb-jplxtqiryjnsdruqxgbh-auth-token',a='740411d2-a2c9-4dd6-84ba-8679514d28fb',b='0b10a8ff-425b-4dc2-9663-d0bfe39e3364';
async function api(route,body,token,admin=false){const k=admin?cfg.STAGING_SERVICE_ROLE_KEY:cfg.STAGING_ANON_KEY,r=await fetch(base+route,{method:body?'POST':'GET',headers:{apikey:k,Authorization:'Bearer '+(token||k),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error(route+' HTTP '+r.status);return r.json();}
(async()=>{
 assert.equal(new URL(base).hostname,'jplxtqiryjnsdruqxgbh.supabase.co');
 const sa=await api('/auth/v1/token?grant_type=password',{email:cfg.STAGING_TEST_EMAIL,password:cfg.STAGING_TEST_PASSWORD});assert.equal(sa.user.id,a);
 // Verify an EXISTING fictional restore-drill account before generating a sign-in link. No email is sent.
 const existing=await api('/auth/v1/admin/users/'+b,null,null,true);assert.equal(existing.email,'pakkibaat.restore.drill.20261017@example.com');
 const link=await api('/auth/v1/admin/generate_link',{type:'magiclink',email:existing.email},null,true);assert.equal(link.id,b);
 const sb=await api('/auth/v1/verify',{type:'magiclink',token_hash:link.hashed_token});assert.equal(sb.user.id,b);
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'pb03-transition-')),c=await chromium.launchPersistentContext(profile,{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 let passed=0;const pass=(name,evidence={})=>{passed++;console.log(JSON.stringify({name,status:'PASS',evidence}));};
 try{
  await c.route('https://uendrvpkyvfxnoxsalpu.supabase.co/**',r=>r.abort());const p=c.pages()[0];await p.goto('http://localhost:3109');await p.evaluate(({key,s})=>localStorage.setItem(key,JSON.stringify(s)),{key,s:sa});await p.reload();await p.waitForFunction(a=>!!localStorage.getItem('pakki-baat-workspace:'+a),a);await p.waitForFunction(()=>!document.querySelector('.workspace-boot-screen'));
  await p.evaluate(()=>navigator.serviceWorker.ready);await p.waitForTimeout(2000);
  const ca=await p.evaluate(a=>localStorage.getItem('pakki-baat-workspace:'+a),a);
  // B has no local cache: its failed cloud load must not expose A.
  await c.setOffline(true);await p.evaluate(({key,s})=>{localStorage.setItem(key,JSON.stringify(s));const ch=new BroadcastChannel(key);ch.postMessage({event:'SIGNED_IN',session:s});setTimeout(()=>ch.close(),1000);},{key,s:sb});await p.waitForTimeout(2500);
  let text=await p.locator('body').innerText();assert.ok(text.includes(existing.email));assert.ok(!text.includes('PB-01-UI-'));assert.equal(await p.evaluate(a=>localStorage.getItem('pakki-baat-workspace:'+a),a),ca);pass('authenticated account B offline with no cache never displays A');
  await c.setOffline(false);await p.reload();await p.waitForFunction(b=>!!localStorage.getItem('pakki-baat-workspace:'+b),b);await p.waitForTimeout(1500);assert.ok((await p.locator('body').innerText()).includes(existing.email));pass('authenticated account B loads only its own cloud workspace');
  await p.getByRole('button',{name:'Sign out',exact:true}).first().click();await p.waitForFunction(key=>!localStorage.getItem(key),key);await p.waitForTimeout(1000);assert.ok(!(await p.locator('body').innerText()).includes(existing.email));assert.ok(!(await p.locator('body').innerText()).includes('PB-01-UI-'));assert.equal(await p.evaluate(a=>localStorage.getItem('pakki-baat-workspace:'+a),a),ca);pass('explicit logout hides account records and keeps separate account cache');
  await c.setOffline(true);await p.reload();await p.waitForFunction(()=>!document.querySelector('.workspace-boot-screen'));assert.ok(!(await p.locator('body').innerText()).includes('PB-01-UI-'));pass('offline reopen after logout remains guest');
  // Evict one critical cached script from BOTH shell and runtime caches.
  const removed=await p.evaluate(async()=>{let target;for(const k of await caches.keys()){const cache=await caches.open(k);for(const r of await cache.keys())if(r.url.includes('/_next/static/')&&r.url.endsWith('.js')){target=r.url;break;}if(target)break;}if(!target)throw Error('no cached JS');for(const k of await caches.keys())await(await caches.open(k)).delete(target);return target;});
  const response=await p.reload();assert.equal(response.status(),503);assert.ok((await p.locator('body').innerText()).includes('Reconnect to reopen Hisaab'));assert.equal(await p.evaluate(a=>localStorage.getItem('pakki-baat-workspace:'+a),a),ca);pass('incomplete production cache returns recovery page without clearing account data',{removed:new URL(removed).pathname});
  console.log(JSON.stringify({passed,failed:0,profile}));
 }finally{await c.close();const resolved=fs.realpathSync(profile),root=fs.realpathSync(os.tmpdir());if(path.dirname(resolved)!==root||!path.basename(resolved).startsWith('pb03-transition-'))throw Error('Unexpected disposable profile path');fs.rmSync(resolved,{recursive:true,force:true});}
})().catch(e=>{console.error(JSON.stringify({status:'FAIL',message:e.message,stack:e.stack?.split('\n').slice(0,4)}));process.exitCode=1;});
