import assert from "node:assert/strict";
// Fixed loopback target: this check never changes hosted inventory.
const base="http://127.0.0.1:5173";
const auth={Cookie:"__sites_local_auth=1"};
const results=[];
async function check(name,path,options,status){
  const r=await fetch(base+path,{...options,redirect:"manual"});assert.equal(r.status,status,name);results.push({name,status});
  return r;
}
await check("API requires a signed-in operator","/api/inventory",{},401);
await check("client identity headers cannot impersonate local sign-in","/api/inventory",{headers:{"oai-authenticated-user-id":"spoof","oai-authenticated-user-email":"spoof@example.invalid"}},401);
await check("JSON-only changes","/api/inventory",{method:"POST",headers:auth,body:"invalid"},415);
await check("malformed JSON is rejected","/api/inventory",{method:"POST",headers:{...auth,"Content-Type":"application/json"},body:"{"},400);
await check("cross-origin changes are rejected","/api/inventory",{method:"POST",headers:{...auth,"Content-Type":"application/json",Origin:"https://example.invalid"},body:JSON.stringify({dataset:"demo",action:"initialize_demo"})},403);
const live=await check("working inventory contains no demo records","/api/inventory?dataset=live",{headers:auth},200);
assert.equal((await live.json()).batteries.length,0);
await check("an unknown battery is unavailable","/api/inventory?dataset=demo&batteryId=UNKNOWN",{headers:auth},404);
await check("live RFID observations remain disabled","/api/inventory",{method:"POST",headers:{...auth,"Content-Type":"application/json"},body:JSON.stringify({dataset:"live",action:"observation",payload:{}})},501);
console.log(JSON.stringify({checks:results.length,passed:true,results},null,2));
