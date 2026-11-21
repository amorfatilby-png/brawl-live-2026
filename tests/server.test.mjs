import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import net from 'node:net';
import http from 'node:http';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function randomPort(){return new Promise((resolve,reject)=>{const sock=net.createServer();sock.listen(0,'127.0.0.1',()=>{const p=sock.address().port;sock.close(()=>resolve(p))});sock.on('error',reject)});}
async function start({feedUrl='',officialScenario=''}={}){
 const port=await randomPort();const dir=await fs.mkdtemp(path.join(os.tmpdir(),'brawl-test-'));
 const stateFile=path.join(dir,'state.json');await fs.copyFile(path.join(ROOT,'data','state.json'),stateFile);
 const env={...process.env,PORT:String(port),ADMIN_KEY:'test-admin-token',STATE_FILE:stateFile,FEED_URL:feedUrl,FEED_PROVIDER:officialScenario?'supercell':feedUrl?'json':'snapshot',FEED_INTERVAL_MS:'15000',TEST_OFFICIAL_SCENARIO:officialScenario};
 const args=officialScenario?['--import',pathToFileURL(path.join(ROOT,'tests','supercell-mock.mjs')).href,'server.mjs']:['server.mjs'];
 const child=spawn(process.execPath,args,{cwd:ROOT,env,stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',chunk=>{errors+=chunk});
 const base=`http://127.0.0.1:${port}`;
 for(let i=0;i<200;i++){if(child.exitCode!==null)throw Error('server exited: '+errors);try{const r=await fetch(base+'/api/state');if(r.ok)return{child,base,dir};}catch{}await new Promise(r=>setTimeout(r,30));}
 child.kill();throw Error('server did not start: '+errors);
}
async function stop(ctx){ctx.child.kill();await fs.rm(ctx.dir,{recursive:true,force:true});}

test('serves HTML and verified snapshot, no fabricated live scores',async()=>{
 const ctx=await start();
 try{
 const doc=await fetch(ctx.base);assert.equal(doc.status,200);assert.match(await doc.text(),/WORLD FINALS/);
 const data=await(await fetch(ctx.base+'/api/state')).json();
 assert.equal(data.mode,'snapshot');assert.deepEqual(data.matches.UQ1,{status:'final',score1:2,score2:3});assert.deepEqual(data.matches.UQ2,{status:'final',score1:0,score2:3});
 const health=await (await fetch(ctx.base+'/health')).json(); assert.equal(health.ok,true);
 }finally{await stop(ctx)}
});

test('official sync reports source and honest timestamps, and prevents mixed manual scores',async()=>{
 const ctx=await start({officialScenario:'success'});
 try{
  const data=await(await fetch(ctx.base+'/api/state')).json();
  assert.equal(data.feedProvider,'supercell');assert.equal(data.updatedAt,null);assert.equal(data.sourceUpdatedAt,null);assert.equal(data.feedChangedAt,null);
  assert.ok(data.feedLastOk);assert.equal(data.feedError,null);assert.equal(data.feedStale,false);assert.equal(data.refreshIntervalSeconds,120);
  assert.equal(Object.keys(data.matches).length,14);assert.equal(data.matches.L1A.status,'live');
  assert.equal((await fetch(ctx.base+'/api/update',{method:'POST',headers:{authorization:'Bearer test-admin-token'}})).status,409);
 }finally{await stop(ctx)}
});

test('initial official failure retains the snapshot with an error and retry deadline',async()=>{
 const ctx=await start({officialScenario:'failure'});
 try{
  const data=await(await fetch(ctx.base+'/api/state')).json();
  assert.equal(data.feedLastOk,null);assert.equal(data.feedStale,true);assert.match(data.feedError,/429/);assert.ok(Date.parse(data.feedRetryAt)>Date.now()+500000);
  assert.deepEqual(data.matches.UQ1,{status:'final',score1:2,score2:3});assert.equal(data.matches.L1A,undefined);
 }finally{await stop(ctx)}
});

for(const scenario of ['rate-limit-after-success','rollback'])test(`official ${scenario} preserves last valid scores`,async()=>{
 const ctx=await start({officialScenario:scenario});
 try{
  let data;
  for(let i=0;i<80;i++){data=await(await fetch(ctx.base+'/api/state')).json();if(data.feedError)break;await new Promise(r=>setTimeout(r,20));}
  assert.ok(data.feedError);assert.ok(data.feedLastOk);assert.equal(data.updatedAt,null);
  assert.deepEqual(data.matches.UQ1,{status:'final',score1:2,score2:3});assert.equal(data.matches.L1A.status,'live');
  if(scenario==='rate-limit-after-success')assert.ok(data.feedRetryAt);
  else assert.match(data.feedError,/回退/);
 }finally{await stop(ctx)}
});

test('admin updates scores and validates final-score rules',async()=>{
 const ctx=await start();
 const update=async (body,token='test-admin-token')=>fetch(ctx.base+'/api/update',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});
 try{
 assert.equal((await update({matches:{UQ2:{status:'final',score1:0,score2:3}}},'wrong')).status,401);
 assert.equal((await update({matches:{UQ2:{status:'final',score1:1,score2:2}}})).status,400);
 const r=await update({matches:{UQ2:{status:'final',score1:0,score2:3}}});assert.equal(r.status,200);
 const state=await(await fetch(ctx.base+'/api/state')).json();assert.equal(state.mode,'manual');assert.equal(state.matches.UQ2.score2,3);
 }finally{await stop(ctx)}
});

test('accepts a configured trusted live JSON feed and reports online mode',async()=>{
 const port=await randomPort();
 const upstream=await new Promise(resolve=>{const srv=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({updatedAt:'2026-11-21T07:30:00Z',matches:{UQ2:{status:'final',score1:0,score2:3}}}))});srv.listen(port,'127.0.0.1',()=>resolve(srv))});
 const ctx=await start({feedUrl:`http://127.0.0.1:${port}/results`});
 try{
 const data=await(await fetch(ctx.base+'/api/state')).json();assert.equal(data.mode,'feed');assert.ok(data.feedLastOk);assert.equal(data.matches.UQ2.score2,3);
 }finally{await stop(ctx);upstream.close()}
});
