const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/sarrah/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const cfg=Object.fromEntries(fs.readFileSync(path.join(__dirname,'../.env.staging.local'),'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]}));
const origin=process.env.PB_RC_URL||'http://localhost:3109',owner='740411d2-a2c9-4dd6-84ba-8679514d28fb';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
let passed=0;const pass=(name,evidence={})=>{passed++;console.log(JSON.stringify({status:'PASS',name,evidence}));};
(async()=>{
 const b=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
  const c=await b.newContext();await c.addInitScript(()=>localStorage.setItem('pakki-baat-installed','1'));
  await c.route('https://uendrvpkyvfxnoxsalpu.supabase.co/**',r=>r.abort());
  const p=await c.newPage();await p.goto(origin);await p.goto(new URL('/qa-login',origin).href);
  const config=await p.evaluate(()=>fetch('/api/public-config').then(r=>r.json()));assert.equal(new URL(config.supabaseUrl).hostname,'jplxtqiryjnsdruqxgbh.supabase.co');
  await p.getByLabel('Email',{exact:true}).fill(cfg.STAGING_TEST_EMAIL);await p.getByLabel('Password',{exact:true}).fill(cfg.STAGING_TEST_PASSWORD);await p.getByRole('button',{name:'Sign in to QA account',exact:true}).click();
  await p.waitForFunction(()=>!!localStorage.getItem('pakki-baat-workspace:740411d2-a2c9-4dd6-84ba-8679514d28fb')&&!document.querySelector('.workspace-boot-screen'));
  const info=await p.evaluate(()=>fetch('/api/release-info').then(r=>r.json()));assert.equal(info.supabaseProject,'jplxtqiryjnsdruqxgbh');assert.equal(info.dependencies.next,'16.4.3');assert.equal(info.dependencies.workflow,'5.2.3');pass('preview-only QA login and dependency/project identity',info);
  const customer='PB11-RC-'+Date.now();await p.getByRole('button',{name:'Hisaab',exact:true}).first().click();await p.getByRole('button',{name:'New customer',exact:true}).click();await p.getByPlaceholder('e.g. Asha').fill(customer);await p.getByRole('button',{name:'Continue',exact:true}).click();await p.getByRole('button',{name:'Fill a form',exact:true}).click();await p.getByPlaceholder('e.g. 2 kg chocolate cake').fill('PB11 online photo validation');await p.getByPlaceholder('e.g. 2000').fill('0');await p.getByPlaceholder('0 if nothing received').fill('0');
  const saved=p.waitForResponse(r=>r.url().endsWith('/rpc/save_workspace_with_ledger')&&r.request().postDataJSON()?.payload?.jobs?.some(j=>j.customer===customer));await p.getByRole('button',{name:'Save to '+customer,exact:true}).click();assert.equal((await saved).status(),200);
  async function cloud(){return p.evaluate(async()=>{const s=JSON.parse(localStorage.getItem('sb-jplxtqiryjnsdruqxgbh-auth-token')),cfg=await fetch('/api/public-config').then(r=>r.json());return fetch(cfg.supabaseUrl+'/rest/v1/workspaces?select=payload,revision',{headers:{apikey:cfg.supabaseAnonKey,Authorization:'Bearer '+s.access_token}}).then(r=>r.json());});}
  const baseline=await cloud(),job=baseline[0].payload.jobs.find(j=>j.customer===customer);assert.ok(job);
  // Expand the new entry and wait for the authenticated no-photo check.
  const card=p.locator('[data-entry-id="'+job.id+'"]');await card.locator('summary').click();const photo=card.getByRole('region',{name:'Entry photo'}),input=photo.getByLabel('Add entry photo');await input.waitFor();
  await input.setInputFiles({name:'bad.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});await photo.getByRole('alert').filter({hasText:'JPG'}).waitFor();pass('invalid photo type rejected in UI');
  let abort=true;const pattern='**/api/hisaab-photo*';await c.route(pattern,route=>{if(abort&&route.request().method()==='POST'){abort=false;return route.abort('failed');}return route.continue();});
  await input.setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});await photo.getByRole('button',{name:'Retry photo',exact:true}).waitFor();pass('network failure keeps retry available without a financial rollback');await c.unroute(pattern);
  const uploaded=p.waitForResponse(r=>r.url().includes('/api/hisaab-photo')&&r.request().method()==='POST');await photo.getByRole('button',{name:'Retry photo',exact:true}).click();assert.equal((await uploaded).status(),201);pass('retry uploads one photo successfully');
  await p.waitForFunction(id=>{const img=document.querySelector('[data-entry-id="'+id+'"] .hisaab-entry-photo-image');return img&&img.naturalWidth>0;},job.id);pass('authenticated photo is displayed');
  await c.setOffline(true);await photo.getByText('Reconnect to view or add this entry\'s photo.').waitFor();assert.equal(await photo.locator('img').count(),0);pass('photo display is unavailable offline as approved');
  await c.setOffline(false);await p.waitForFunction(id=>{const img=document.querySelector('[data-entry-id="'+id+'"] .hisaab-entry-photo-image');return img&&img.naturalWidth>0;},job.id);pass('photo returns after reconnect');
  assert.deepEqual(await cloud(),baseline);pass('upload and reconnect leave financial snapshot and revision unchanged',{revision:baseline[0].revision,entryId:job.id});
  await p.getByRole('button',{name:'Sign out',exact:true}).first().click();await p.waitForFunction(()=>!localStorage.getItem('sb-jplxtqiryjnsdruqxgbh-auth-token'));assert.equal(await p.locator('.hisaab-entry-photo-image').count(),0);pass('logout removes private photo display');
  console.log(JSON.stringify({passed,failed:0,customer,entryId:job.id,commit:info.commit}));
 }finally{await b.close();}
})().catch(e=>{console.error(JSON.stringify({status:'FAIL',message:e.message,stack:e.stack?.split('\n').slice(0,4)}));process.exitCode=1;});
