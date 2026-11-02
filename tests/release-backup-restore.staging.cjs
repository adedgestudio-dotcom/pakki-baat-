// Fresh isolated staging application backup and private-asset restore drill.
// No production connection, source-table restore, account mutation or secret export.
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),ref='jplxtqiryjnsdruqxgbh';
const cfg=Object.fromEntries(fs.readFileSync(path.join(root,'.env.staging.local'),'utf8').split(/\r?\n/).filter(x=>/^[A-Z_]+=/.test(x)).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1).replace(/^['"]|['"]$/g,'')]}));
const base=cfg.STAGING_SUPABASE_URL,key=cfg.STAGING_SERVICE_ROLE_KEY,headers={apikey:key,Authorization:'Bearer '+key};
const names=['workspaces','workspace_ledger_modes','hisaab_ledger_transactions','hisaab_entry_photos','workspace_backups','workspace_backup_preferences','subscriptions'];
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fetchOk(route,init={}){const r=await fetch(base+route,{...init,headers:{...headers,...init.headers}});if(!r.ok)throw Error(route+' HTTP '+r.status);return r;}
function protect(file){if(process.platform!=='win32'){fs.chmodSync(file,0o600);return;}const owner=(process.env.USERDOMAIN?process.env.USERDOMAIN+'\\':'')+process.env.USERNAME;const r=cp.spawnSync('icacls.exe',[file,'/inheritance:r','/grant:r',owner+':(F)','*S-1-5-18:(F)'],{windowsHide:true,encoding:'utf8'});if(r.status!==0)throw Error('Could not restrict backup file permissions');}
(async()=>{
 assert.equal(new URL(base).hostname,ref+'.supabase.co');
 const users=(await(await fetchOk('/auth/v1/admin/users?per_page=100')).json()).users;
 assert.ok(users.every(u=>['ledger-staging-01@example.com','pakkibaat.restore.drill.20261017@example.com'].includes(u.email)),'Refuse export when staging contains unreviewed/nonfictional users');
 const tables={};
 for(const name of names)tables[name]=await(await fetchOk('/rest/v1/'+name+'?select=*')).json();
 const assets=[];
 for(const row of tables.hisaab_entry_photos){const bytes=Buffer.from(await(await fetchOk('/storage/v1/object/authenticated/hisaab-entry-photos/'+row.object_path)).arrayBuffer());assets.push({path:row.object_path,type:row.content_type,sha256:sha(bytes),base64:bytes.toString('base64')});}
 const manifest={format:'pakki-baat-staging-application-backup/v1',projectRef:ref,createdAt:new Date().toISOString(),tables,assets};
 const text=JSON.stringify(manifest),checksum=sha(text),dir=path.join(root,'output','rc-private-backups');fs.mkdirSync(dir,{recursive:true});
 const stem='staging-'+manifest.createdAt.replace(/[:.]/g,'-'),backup=path.join(dir,stem+'.json');fs.writeFileSync(backup,text,{flag:'wx',mode:0o600});protect(backup);assert.equal(sha(fs.readFileSync(backup)),checksum);
 let passed=1;console.log(JSON.stringify({status:'PASS',name:'fresh staging backup written and verified',checksum,backup,rows:Object.fromEntries(names.map(n=>[n,tables[n].length])),photos:assets.length}));
 const changed=structuredClone(manifest);changed.tables.workspaces[0].payload.owner+=' altered';assert.notEqual(sha(JSON.stringify(changed)),checksum);passed++;console.log(JSON.stringify({status:'PASS',name:'backup checksum detects alteration'}));
 // Typed JSON restore into transaction-local tables; LIKE never copies source triggers.
 const sql=['begin;',"set local lock_timeout='3s';","set local statement_timeout='30s';",`do $$ begin if not exists(select 1 from auth.users where id='740411d2-a2c9-4dd6-84ba-8679514d28fb' and email='ledger-staging-01@example.com') then raise exception 'STAGING_QA_REQUIRED'; end if; end $$;`];
 for(const name of names){const json=JSON.stringify(tables[name]),tag='$pb_rc_'+randomUUID().replaceAll('-','')+'$';assert.ok(!json.includes(tag));sql.push(`create temp table rc_restore_${name} (like public.${name} including all);`,`insert into rc_restore_${name} select * from jsonb_populate_recordset(null::public.${name},${tag}${json}${tag}::jsonb);`,`do $$ begin if (select count(*) from rc_restore_${name})<>${tables[name].length} then raise exception 'RESTORE_ROW_COUNT_${name}'; end if; if exists((select * from rc_restore_${name}) except all (select * from jsonb_populate_recordset(null::public.${name},${tag}${json}${tag}::jsonb))) then raise exception 'RESTORE_CONTENT_${name}'; end if; end $$;`);}
 sql.push(`do $$ declare w record; j jsonb; charges bigint; paid bigint; begin
  for w in select s.* from rc_restore_workspaces s join rc_restore_workspace_ledger_modes m using(owner_id) where m.enabled loop
   for j in select value from jsonb_array_elements(w.payload->'jobs') loop
    select coalesce(sum(l.amount_paise) filter(where l.transaction_kind='charge'),0),coalesce(sum(l.amount_paise) filter(where l.transaction_kind='payment'),0) into charges,paid
    from rc_restore_hisaab_ledger_transactions l where l.owner_id=w.owner_id and l.job_id=j->>'id'
     and not exists(select 1 from rc_restore_hisaab_ledger_transactions r where r.reverses_transaction_id=l.id);
    if charges<>public.hisaab_snapshot_paise(j->'total') or paid<>public.hisaab_snapshot_paise(j->'paid') then raise exception 'RESTORED_LEDGER_BALANCE_MISMATCH'; end if;
   end loop;
  end loop;
  if exists(select 1 from rc_restore_hisaab_entry_photos p where split_part(p.object_path,'/',1)<>p.owner_id::text) then raise exception 'RESTORED_PHOTO_ACCOUNT_MISMATCH'; end if;
 end $$;`,`select ${names.length+2} passed,0 failed,'Seven typed table restores, ledger balance reconciliation and photo owner isolation' evidence;`,'rollback;');
 const sqlFile=path.join(dir,stem+'.restore.sql');fs.writeFileSync(sqlFile,sql.join('\n'),{flag:'wx',mode:0o600});protect(sqlFile);
 // Restore only copied photo bytes into a NEW private drill bucket, then remove that temporary copy.
 const drill='pb-rc-restore-'+randomUUID();assert.ok(drill.startsWith('pb-rc-restore-')&&drill!=='hisaab-entry-photos');
 await fetchOk('/storage/v1/bucket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:drill,name:drill,public:false,file_size_limit:5242880,allowed_mime_types:['image/jpeg','image/png','image/webp']})});
 const copied=[];
 try{for(const asset of assets){const bytes=Buffer.from(asset.base64,'base64');assert.equal(sha(bytes),asset.sha256);await fetchOk('/storage/v1/object/'+drill+'/'+asset.path,{method:'POST',headers:{'Content-Type':asset.type,'x-upsert':'false'},body:bytes});copied.push(asset.path);const restored=Buffer.from(await(await fetchOk('/storage/v1/object/authenticated/'+drill+'/'+asset.path)).arrayBuffer());assert.equal(sha(restored),asset.sha256);passed++;}
  console.log(JSON.stringify({status:'PASS',name:'photo assets restored into an isolated private bucket with matching SHA-256',photos:assets.length}));
 }finally{if(copied.length)await fetchOk('/storage/v1/object/'+drill,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:copied})});await fetchOk('/storage/v1/bucket/'+drill,{method:'DELETE'});}
 console.log(JSON.stringify({passed,failed:0,backup,checksum,restoreSql:sqlFile,note:'Run generated SQL ONLY through the explicitly targeted staging connection; all restores are temporary and rolled back. This is an application-data/asset backup, not proof of platform/PITR restoration.'}));
})().catch(e=>{console.error(JSON.stringify({status:'FAIL',message:e.message}));process.exitCode=1;});
