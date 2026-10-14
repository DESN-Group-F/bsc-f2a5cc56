import test from 'node:test';
import assert from 'node:assert/strict';
import { captureDetailBoundary, verifyDetailBoundary } from '../src/app/detail-boundary.mjs';

const fixture=()=>({teachingGroups:[{id:'group-1',version:3,ownerAccountId:'staff-1',state:'active',batteryIds:['BAT001']}]});
test('group scope pins the opened version and retains it in operations and export',()=>{
  const data=fixture(),context={kind:'group',id:'group-1',label:'Class set'};
  const detail=captureDetailBoundary(data,'staff-1','BAT001',context);
  context.id='other';
  assert.deepEqual(detail.group,{id:'group-1',version:3});
  assert.equal(detail.scope.id,'group-1');
  assert.deepEqual(verifyDetailBoundary(detail,data,'staff-1'),detail.group);
});
test('version, membership, removal and foreign ownership fail closed with the original reference retained',()=>{
  const detail=captureDetailBoundary(fixture(),'staff-1','BAT001',{kind:'group',id:'group-1'}),original=JSON.stringify(detail);
  for(const change of [group=>group.version++,group=>group.batteryIds=[],group=>group.state='removed',group=>group.ownerAccountId='other']){
    const data=fixture();change(data.teachingGroups[0]);
    assert.throws(()=>verifyDetailBoundary(detail,data,'staff-1'),/blocked/);
    assert.equal(JSON.stringify(detail),original);
  }
  assert.throws(()=>verifyDetailBoundary(detail,{teachingGroups:[]},'staff-1'),/blocked/);
});
test('stale opening never substitutes a shared single-record boundary',()=>{
  assert.throws(()=>captureDetailBoundary(fixture(),'staff-1','BAT001',{id:'group-1',version:2}),/changed/);
  assert.throws(()=>captureDetailBoundary(fixture(),'staff-1','BAT002',{kind:'group',id:'group-1'}),/changed/);
  assert.deepEqual(captureDetailBoundary(fixture(),'staff-1','BAT001',{kind:'owner',id:'staff-1'}),{id:'BAT001',scope:{kind:'owner',id:'staff-1'}});
});
