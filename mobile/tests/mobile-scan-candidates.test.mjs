import test from 'node:test';
import assert from 'node:assert/strict';
import { filterScanCandidates, projectScanCandidates } from '../src/features/scan/scan-candidates.mjs';

const battery=(id,changes={})=>({id,name:`Battery ${id}`,version:1,loanId:null,lifecycleStatus:'active',ownerAccountId:'STAFF-A',...changes});
const project=(batteries,changes={})=>projectScanCandidates({kind:'checkout',accountId:'STAFF-A',data:{batteries,teachingGroups:[],rooms:[]},scope:null,teachingGroup:null,queue:[],completed:[],...changes});
const ids=values=>values.map(value=>value.id);

test('manual eligibility keeps lifecycle, queued identity and exact completed version/loan distinctions',()=>{
  const values=[battery('available'),battery('queued'),battery('same'),battery('new-version',{version:2}),battery('different-loan',{loanId:'new-loan'}),battery('retired',{lifecycleStatus:'scrapped'}),battery('legacy-loan-field',{loanId:undefined})];
  const completed=[{battery:battery('same')},{battery:battery('new-version')},{battery:battery('different-loan',{loanId:'old-loan'})},{battery:battery('legacy-loan-field')}];
  assert.deepEqual(ids(project(values,{queue:[{battery:values[1]}],completed})),['available','new-version','legacy-loan-field']);
  assert.deepEqual(ids(project(values,{kind:'return',completed})),['different-loan']);
  assert.deepEqual(ids(project([battery('different-loan',{loanId:'old-loan'})],{kind:'return',completed})),[]);
});

test('captured group version, fixed membership and personal holder authority intersect without broadening',()=>{
  const values=[battery('member',{loanId:'loan-a',borrowerAccountId:'STAFF-A'}),battery('foreign-holder',{loanId:'loan-b',borrowerAccountId:'STAFF-B'}),battery('outside',{loanId:'loan-c',borrowerAccountId:'STAFF-A'})];
  const data={batteries:values,teachingGroups:[{id:'GROUP-A',version:4,batteryIds:['member','foreign-holder']}],rooms:[]};
  const context={kind:'return',data,scope:{kind:'holder',id:'STAFF-A'},teachingGroup:{id:'GROUP-A',version:4}};
  assert.deepEqual(ids(project(values,context)),['member']);
  assert.deepEqual(ids(project(values,{...context,accountId:'STAFF-B'})),[]);
  assert.deepEqual(ids(project(values,{...context,teachingGroup:{id:'GROUP-A',version:3}})),[]);
  assert.deepEqual(ids(project(values,{...context,scope:{kind:'ids',batteryIds:['outside']}})),[]);
});

test('search uses only existing displayed identity facts and preserves server ordering',()=>{
  const values=[battery('BAT-42',{name:'Teaching pack',tagId:'TAG-A',borrowerName:'Alex'}),battery('BAT-01',{name:'Teaching spare',tagId:'TAG-B'}),battery('BAT-77',{name:'Storage pack'})];
  for(const query of ['bat-42','tAg-A','ALEX'])assert.deepEqual(ids(filterScanCandidates(values,query)),['BAT-42']);
  assert.deepEqual(ids(filterScanCandidates(values,'teaching')),['BAT-42','BAT-01']);
  assert.deepEqual(filterScanCandidates(values,'unregistered'),[]);
});
