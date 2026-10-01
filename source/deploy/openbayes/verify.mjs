import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const project=fileURLToPath(new URL('../../',import.meta.url));
const bundle=path.join(project,'work/openbayes/bundle');
const data=path.join(project,'work/qa',`portable-${randomUUID()}`);
const access=JSON.parse(await readFile(path.join(project,'work/openbayes/access.json'),'utf8'));
const contract=JSON.parse(await readFile(path.join(bundle,'auth-contract.json'),'utf8'));
const evidence={checks:[],startedAt:new Date().toISOString()};
const check=(name)=>evidence.checks.push({name,result:'passed'});

async function start(seconds){
  const child=spawn(process.execPath,[path.join(project,'deploy/openbayes/runtime.mjs')],{
    cwd:project,env:{...process.env,PORT:'0',INVENTORY_LOCAL_TEST:'1',INVENTORY_LISTEN_HOST:'127.0.0.1',
      INVENTORY_BUNDLE_ROOT:bundle,INVENTORY_DATA_ROOT:data,INVENTORY_MAX_SECONDS:String(seconds)},
    stdio:['ignore','pipe','pipe'],
  });
  let output='',errors='';
  child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{errors+=chunk;});
  const finished=new Promise((resolve,reject)=>child.once('exit',code=>code===0?resolve():reject(Error(`Runtime exited ${code}: ${errors}`))));
  finished.catch(()=>{});
  const ready=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error(`Runtime did not become ready: ${errors}`)),10000);
    child.stdout.on('data',()=>{
      const line=output.split('\n').find(line=>line.includes('"event":"inventory_ready"'));
      if(line){clearTimeout(timeout);resolve(JSON.parse(line));}
    });
    child.once('exit',()=>{clearTimeout(timeout);reject(Error(`Runtime exited before readiness: ${errors}`));});
  });
  return{origin:`http://127.0.0.1:${ready.port}`,finished,output:()=>output};
}
async function signIn(origin){
  const response=await fetch(`${origin}/login`,{method:'POST',redirect:'manual',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...access,return_to:'/'}).toString()});
  assert.equal(response.status,303);
  const cookie=response.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  return cookie.split(';')[0];
}
async function post(origin,cookie,action,payload){
  const response=await fetch(`${origin}/api/inventory`,{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({dataset:'demo',action,payload})});
  assert.equal(response.status,200,await response.clone().text());return response.json();
}

await mkdir(data,{recursive:true});
const first=await start(8),origin=first.origin;
let response=await fetch(`${origin}/api/inventory?dataset=demo`,{headers:{[contract.headers.userId]:'portable-admin',[contract.headers.email]:'admin@inventory.local',Cookie:'preview_auth=1'}});
assert.equal(response.status,401);check('Public clients cannot spoof administrator identity');
response=await fetch(`${origin}/`,{redirect:'manual'});assert.equal(response.status,303);assert.match(response.headers.get('location'),/^\/login/);check('Inventory pages require sign-in');
response=await fetch(`${origin}/login`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:'username=admin&password=incorrect'});assert.equal(response.status,401);check('Incorrect password is rejected');
let cookie=await signIn(origin);check('Administrator sign-in issues a protected session cookie');
response=await fetch(`${origin}/api/inventory`,{method:'POST',headers:{Origin:'https://untrusted.example',Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);check('Cross-origin writes are rejected');
response=await fetch(`${origin}/`,{headers:{Cookie:cookie}});assert.equal(response.status,200);const html=await response.text();assert.match(html,/Battery Inventory/i);
const script=html.match(/src="([^"]+\.js)"/);assert.ok(script);response=await fetch(origin+script[1],{headers:{Cookie:cookie}});assert.equal(response.status,200);check('Production page and JavaScript assets are served');
await post(origin,cookie,'initialize_demo');
let snapshot=await(await fetch(`${origin}/api/inventory?dataset=demo`,{headers:{Cookie:cookie}})).json();assert.equal(snapshot.batteries.length,6);check('Committed migrations support the complete inventory API');
const movement={requestId:randomUUID(),kind:'checkout',batteryIds:['BAT-002'],borrowerId:'demo-student-1'};
await post(origin,cookie,'movement',movement);const replay=await post(origin,cookie,'movement',movement);assert.equal(replay.result.replayed,true);
await post(origin,cookie,'movement',{requestId:randomUUID(),kind:'return',batteryIds:['BAT-002']});
let detail=await(await fetch(`${origin}/api/inventory?dataset=demo&batteryId=BAT-002`,{headers:{Cookie:cookie}})).json();assert.equal(detail.loans.length,1);assert.ok(detail.loans[0].returnedAt);check('Checkout, replay and return retain one complete loan history');
await first.finished;assert.match(first.output(),/preserving database/);check('Automatic time limit closes the runtime cleanly');
const second=await start(3);cookie=await signIn(second.origin);
snapshot=await(await fetch(`${second.origin}/api/inventory?dataset=demo`,{headers:{Cookie:cookie}})).json();assert.equal(snapshot.batteries.length,6);
detail=await(await fetch(`${second.origin}/api/inventory?dataset=demo&batteryId=BAT-002`,{headers:{Cookie:cookie}})).json();assert.equal(detail.loans.length,1);assert.ok(detail.loans[0].returnedAt);check('Database records and audit history survive a runtime restart');
const working=await(await fetch(`${second.origin}/api/inventory?dataset=live`,{headers:{Cookie:cookie}})).json();assert.equal(working.batteries.length,0);check('Working inventory stays separate from demonstration records');
await second.finished;
evidence.finishedAt=new Date().toISOString();
await writeFile(path.join(project,'work/qa/openbayes-verification.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
