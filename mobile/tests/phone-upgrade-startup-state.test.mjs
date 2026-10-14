import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupCoordinator, startupPresentation } from '../src/app/startup-state.mjs';
import { markPhoneMilestone } from '../src/app/phone-milestones.mjs';

const deferred = () => { let resolve,reject; const promise = new Promise((done,fail) => { resolve=done; reject=fail; }); return {promise,resolve,reject}; };
const tick = () => new Promise(resolve => setImmediate(resolve));

test('a saved session remains in checking state until its actual response, with no signed-out flash', async () => {
  const session=deferred(), phases=[];
  const startup=createStartupCoordinator({prepare:async()=>({origin:'https://fixture.example'}),checkSession:()=>session.promise});
  startup.subscribe(()=>phases.push(startup.getSnapshot().phase));
  const pending=startup.start(); await tick();
  assert.equal(startup.getSnapshot().phase,'checking-session');
  assert.equal(startup.getSnapshot().user,null); assert.equal(phases.includes('signed-out'),false);
  const user={id:'staff-fixture'}; session.resolve(user); await pending;
  assert.equal(startup.getSnapshot().phase,'authenticated'); assert.equal(startup.getSnapshot().user,user);
});

test('connection retry reuses prepared local data and never clears credentials or saved work', async () => {
  let preparation=0,checks=0; const retained={requestId:'unchanged-original'};
  const startup=createStartupCoordinator({prepare:async()=>{preparation++;return{origin:'https://fixture.example',retained};},checkSession:async runtime=>{assert.equal(runtime.retained,retained);if(++checks===1)throw new Error('Connection unavailable');return null;}});
  await startup.start(); assert.equal(startup.getSnapshot().phase,'failed'); assert.equal(startup.getSnapshot().failedStage,'session');
  assert.equal(startupPresentation(startup.getSnapshot()).action,'Retry connection');
  await startup.start(); assert.equal(startup.getSnapshot().phase,'signed-out'); assert.equal(preparation,1); assert.equal(checks,2); assert.equal(retained.requestId,'unchanged-original');
});

test('local failure blocks session checking and retry only reopens the preserved source', async () => {
  let loads=0,checks=0; const raw='preserved unreadable evidence';
  const startup=createStartupCoordinator({prepare:async()=>{assert.equal(raw,'preserved unreadable evidence');if(++loads===1)throw new Error('Local read unavailable');return{origin:'https://fixture.example'};},checkSession:async()=>{checks++;return null;}});
  await startup.start(); assert.equal(checks,0); assert.equal(startup.getSnapshot().failedStage,'local');
  await startup.start(); assert.equal(loads,2); assert.equal(checks,1); assert.equal(raw,'preserved unreadable evidence');
});

test('repeated entry during preparation shares work and a disposed document rejects late adoption', async () => {
  const preparation=deferred(); let prepares=0,checks=0,changes=0;
  const startup=createStartupCoordinator({prepare:()=>{prepares++;return preparation.promise;},checkSession:async()=>{checks++;return{id:'late'};}});
  startup.subscribe(()=>changes++); const first=startup.start(), second=startup.start(); assert.equal(first,second);
  startup.dispose(); const previous=changes; preparation.resolve({origin:'https://fixture.example'}); await first;
  assert.equal(prepares,1);assert.equal(checks,0);assert.equal(changes,previous);assert.equal(startup.getSnapshot().user,null);
});

test('expiry or explicit login invalidates a still-pending startup session response', async () => {
  const response=deferred();const startup=createStartupCoordinator({prepare:async()=>({origin:'https://fixture.example'}),checkSession:()=>response.promise});
  const checking=startup.start();await tick();startup.signedOut();response.resolve({id:'expired-session'});await checking;
  assert.equal(startup.getSnapshot().phase,'signed-out');assert.equal(startup.getSnapshot().user,null);
  const signedIn={id:'new-confirmed-staff'};startup.signedIn(signedIn);assert.equal(startup.getSnapshot().user,signedIn);
});

test('first setup does not query an unconfigured origin and a newly configured document resolves its session', async () => {
  let origin='unconfigured',checks=0;
  const factory=()=>createStartupCoordinator({prepare:async()=>({origin}),checkSession:async()=>{checks++;return{id:'configured-staff'};}});
  const first=factory();await first.start();assert.equal(first.getSnapshot().phase,'configuration');assert.equal(checks,0);
  first.dispose();origin='https://fixture.example';const nextDocument=factory();await nextDocument.start();
  assert.equal(nextDocument.getSnapshot().phase,'authenticated');assert.equal(checks,1);
});

test('neutral readiness marks are emitted once without timers or account data', () => {
  const names=[];const performance={getEntriesByName:name=>names.filter(item=>item===name),mark:name=>names.push(name)};
  for(const name of ['local-ready','session-resolved','first-interactive']){markPhoneMilestone(name,performance);markPhoneMilestone(name,performance);}
  assert.deepEqual(names,['phone:local-ready','phone:session-resolved','phone:first-interactive']);
});
