import {Miniflare} from 'miniflare';
import {createHash, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, readdir} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Readable} from 'node:stream';

const root=process.env.INVENTORY_BUNDLE_ROOT || fileURLToPath(new URL('./',import.meta.url));
const dataRoot=path.resolve(process.env.INVENTORY_DATA_ROOT || path.join(root,'data'));
const config=JSON.parse(await readFile(path.join(root,'bootstrap.json'),'utf8'));
const contract=JSON.parse(await readFile(path.join(root,'auth-contract.json'),'utf8'));
await mkdir(dataRoot,{recursive:true,mode:0o700});
const serverRoot=path.join(root,'dist/server');
const files=(await readdir(serverRoot,{recursive:true})).filter(f=>/\.m?js$/.test(f));
files.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:a.localeCompare(b));
const runtime=new Miniflare({
  host:'127.0.0.1',port:0,cf:false,
  modules:files.map(f=>({type:'ESModule',path:path.join(serverRoot,f)})),modulesRoot:serverRoot,
  compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  assets:{directory:path.join(root,'dist/client'),routerConfig:{has_user_worker:true}},
  d1Databases:{DB:'battery-inventory-portable'},d1Persist:path.join(dataRoot,'d1'),
  cachePersist:false,liveReload:false,
});

// Apply the same committed migration files to this independent database.
const db=await runtime.getD1Database('DB');
await db.prepare('CREATE TABLE IF NOT EXISTS portable_migrations (name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)').run();
const journal=JSON.parse(await readFile(path.join(root,'drizzle/meta/_journal.json'),'utf8'));
for(const entry of journal.entries){
  const sql=await readFile(path.join(root,`drizzle/${entry.tag}.sql`),'utf8');
  const hash=createHash('sha256').update(sql).digest('hex');
  const previous=await db.prepare('SELECT sha256 FROM portable_migrations WHERE name=?').bind(entry.tag).first();
  if(previous){if(previous.sha256!==hash)throw Error(`Applied migration changed: ${entry.tag}`);continue;}
  const statements=sql.split('--> statement-breakpoint').filter(s=>s.trim()).map(s=>db.prepare(s));
  statements.push(db.prepare('INSERT INTO portable_migrations(name,sha256,applied_at) VALUES(?,?,?)').bind(entry.tag,hash,new Date().toISOString()));
  await db.batch(statements);
}

const sessions=new Map();
const cookieName='inventory_session';
const localMode=process.env.INVENTORY_LOCAL_TEST==='1';
const cookieOptions=`Path=/; HttpOnly; SameSite=Strict${localMode?'':'; Secure'}`;
const identity={
  [contract.headers.userId]:'portable-admin',
  [contract.headers.email]:'admin@inventory.local',
  [contract.headers.fullName]:'admin',
  [contract.headers.fullNameEncoding]:contract.fullNameEncoding,
};
const loginPaths=new Set(['/login',contract.routes.signIn,contract.routes.callback]);
let loginAttempts=[];

function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeReturn(value){
  try{const url=new URL(value||'/','https://inventory.local');return url.origin==='https://inventory.local'&&!loginPaths.has(url.pathname)&&url.pathname!=='/logout'&&url.pathname!==contract.routes.signOut?url.pathname+url.search:'/';}catch{return '/';}
}
function renderLogin(returnTo,error=''){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Battery Inventory — Sign in</title><style>body{margin:0;background:#f2f3f5;font:16px Arial,sans-serif;color:#222}header{background:#111;color:#fff;border-bottom:5px solid #ffda25;padding:22px 30px;font-weight:bold}main{max-width:360px;margin:70px auto;background:#fff;padding:32px;border:1px solid #ddd;border-radius:6px}h1{font-size:24px;margin:0 0 12px}p{color:#666;line-height:1.5}label{display:block;margin-top:18px;font-weight:bold}input{width:100%;box-sizing:border-box;padding:12px;margin-top:7px;border:1px solid #aaa;border-radius:4px;font-size:16px}button{width:100%;margin-top:24px;padding:13px;background:#ffda25;border:0;border-radius:4px;font-size:16px;font-weight:bold}.error{color:#b02020}</style></head><body><header>Battery Inventory</header><main><h1>Administrator sign in</h1><p>Use the demonstration account to open this inventory.</p>${error?`<p class="error" role="alert">${escapeHtml(error)}</p>`:''}<form action="/login" method="post"><input type="hidden" name="return_to" value="${escapeHtml(returnTo)}"><label for="username">Username</label><input id="username" name="username" value="admin" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form></main></body></html>`;
}
function send(res,status,body,extra={}){
  res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'same-origin',...extra});res.end(body);
}
async function bodyBytes(req){
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>260000)throw Object.assign(Error('Request body is too large.'),{status:413});chunks.push(chunk);}return Buffer.concat(chunks);
}
function authenticated(req){
  const match=(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(`${cookieName}=`));
  const token=match?.slice(cookieName.length+1),expires=token?sessions.get(token):0;
  if(expires&&expires>Date.now())return true;if(token)sessions.delete(token);return false;
}
function publicOrigin(req){
  const host=req.headers.host;
  if(!host||!/^[a-zA-Z0-9.:[\]-]+$/.test(host))throw Object.assign(Error('Invalid host.'),{status:400});
  return `${localMode?'http':'https'}://${host}`;
}

const server=http.createServer(async(req,res)=>{
  try{
    const origin=publicOrigin(req),url=new URL(req.url,origin);
    if(url.origin!==origin)return send(res,400,'Invalid request URL.');
    if(url.pathname==='/healthz')return send(res,200,'ok',{'Content-Type':'text/plain; charset=utf-8'});
    const mutating=!['GET','HEAD','OPTIONS'].includes(req.method);
    if(mutating&&req.headers.origin!==origin)return send(res,403,'Cross-origin changes are not allowed.');
    if(loginPaths.has(url.pathname)){
      const returnTo=safeReturn(url.searchParams.get('return_to'));
      if(req.method==='GET')return send(res,200,renderLogin(returnTo));
      if(req.method!=='POST')return send(res,405,'Method not allowed.');
      if(!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded'))return send(res,415,'Send a sign-in form.');
      loginAttempts=loginAttempts.filter(at=>at>Date.now()-60000);
      if(loginAttempts.length>=12)return send(res,429,renderLogin(returnTo,'Too many sign-in attempts. Wait one minute.'),{'Retry-After':'60'});
      loginAttempts.push(Date.now());
      const form=new URLSearchParams((await bodyBytes(req)).toString('utf8'));
      const password=form.get('password')||'';
      const hash=scryptSync(password,config.passwordSalt,64);
      const valid=password.length<256&&form.get('username')==='admin'&&timingSafeEqual(hash,Buffer.from(config.passwordHash,'hex'));
      if(!valid)return send(res,401,renderLogin(safeReturn(form.get('return_to')),'The username or password is incorrect.'));
      const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+4*3600000);
      return send(res,303,'',{'Location':safeReturn(form.get('return_to')),'Set-Cookie':`${cookieName}=${token}; Max-Age=14400; ${cookieOptions}`});
    }
    if(!authenticated(req)){
      if(url.pathname.startsWith('/api/'))return send(res,401,JSON.stringify({error:'Sign in to access the inventory.'}),{'Content-Type':'application/json'});
      return send(res,303,'',{'Location':`/login?return_to=${encodeURIComponent(url.pathname+url.search)}`});
    }
    if(url.pathname==='/logout'||url.pathname===contract.routes.signOut){
      const match=(req.headers.cookie||'').match(/(?:^|;\s*)inventory_session=([^;]+)/);if(match)sessions.delete(match[1]);
      return send(res,303,'',{'Location':'/login','Set-Cookie':`${cookieName}=; Max-Age=0; ${cookieOptions}`});
    }
    const headers=new Headers();
    const blocked=/^(?:x-miniflare-|x-vinext-prerender|cf-access-)/i;
    for(const [key,value] of Object.entries(req.headers)){
      if(key.startsWith(contract.headerPrefix)||blocked.test(key)||['host','cookie','authorization','connection','transfer-encoding','content-length','x-forwarded-host','x-forwarded-proto'].includes(key))continue;
      if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
    }
    for(const [key,value] of Object.entries(identity))headers.set(key,value);
    const body=mutating?await bodyBytes(req):undefined;
    const response=await runtime.dispatchFetch(url.href,{method:req.method,headers,body});
    const outgoing=Object.fromEntries(response.headers);
    delete outgoing['content-length'];delete outgoing['transfer-encoding'];
    // Miniflare fetch has already decoded compressed response bodies.
    delete outgoing['content-encoding'];
    outgoing['x-content-type-options']='nosniff';outgoing['x-frame-options']='DENY';
    outgoing['cache-control']='no-store';
    res.writeHead(response.status,outgoing);
    if(req.method==='HEAD'||!response.body)return res.end();
    Readable.fromWeb(response.body).on('error',()=>res.destroy()).pipe(res);
  }catch(error){console.error('Gateway request failed:',error.message);if(!res.headersSent)send(res,error.status||503,'The inventory could not complete this request.');else res.destroy();}
});
server.requestTimeout=30000;server.headersTimeout=15000;
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(process.env.PORT||8080),process.env.INVENTORY_LISTEN_HOST||'0.0.0.0',resolve);});
console.log(JSON.stringify({event:'inventory_ready',port:server.address().port,migrations:journal.entries.length,dataDirectory:dataRoot}));
let closing=false;
async function shutdown(){if(closing)return;closing=true;console.log('Stopping inventory and preserving database.');server.close();server.closeIdleConnections();await runtime.dispose();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
// This limit complements the outer task supervisor. It cannot be disabled for the demo.
setTimeout(shutdown,Math.min(Number(process.env.INVENTORY_MAX_SECONDS||7200),7200)*1000);
