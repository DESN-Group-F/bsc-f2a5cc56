import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { readNfcProposal, recoverNfcEvidence, NFC_PREFIX } from '../src/business/nfc-controller.mjs';
import { MOBILE_BUILD } from '../src/app/build-info.mjs';
import { APP_VERSION, STORAGE_KEY, emptyState, loadState, createExport } from '../src/diagnostics.mjs';
const store=()=>{const entries={};return {getItem:key=>entries[key]??null,setItem:(key,value)=>{entries[key]=value;},entries:()=>({...entries}),flush:async()=>{}};};
test('native configurations keep Capacitor framework payloads out of Android and iOS logs', async () => {
  const source = await readFile(new URL('../capacitor.config.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/^export default config;/m, 'return config;');
  const config = new Function(compiled)();
  assert.equal(config.android?.loggingBehavior, 'none');
  assert.equal(Object.hasOwn(config, 'loggingBehavior'), false, 'Do not change the cross-platform logging default.');
  assert.equal(config.ios?.loggingBehavior, 'none');
});
test('new diagnostic capture identifies the actual build even when the controlled read is cancelled',async()=>{
  const storage=store();
  await assert.rejects(readNfcProposal({id:'controlled-new-build',storage,platform:'android',now:()=> '2026-10-12T03:00:00.000Z',adapter:{read:async()=>{throw Object.assign(new Error('Controlled cancellation'),{code:'CANCELLED'});}}}),/Controlled cancellation/);
  const report=JSON.parse(storage.getItem(NFC_PREFIX+'controlled-new-build'));
  assert.equal(report.buildVersion,MOBILE_BUILD);assert.equal(report.outcome,'cancelled');assert.equal(report.result,null);
});
test('recovery keeps original version metadata and bytes of completed historical diagnostic records',()=>{
  const storage=store(),raw=JSON.stringify({id:'historical',source:'native-nfc-reader',buildVersion:'0.2.0',startedAt:'2026-10-12T00:00:00.000Z',endedAt:'2026-10-12T00:00:01.000Z',outcome:'failed',result:null,error:{code:'CONTROLLED',message:'Historical controlled record'}});
  storage.setItem(NFC_PREFIX+'historical',raw);recoverNfcEvidence(storage);
  assert.equal(storage.getItem(NFC_PREFIX+'historical'),raw);
});
test('field-test export identifies the current build while historical trial metadata and storage identity stay unchanged',()=>{
  const state=emptyState(),report={id:'historical-field',appVersion:'0.2.0',startedAt:'2026-10-12T00:00:00.000Z',endedAt:'2026-10-12T00:00:01.000Z',outcome:'failed',platform:'android',setup:{...state.settings},source:'native-nfc-reader',result:null,error:{code:'CONTROLLED',message:'Historical controlled trial'}};
  state.reports.push(report);const raw=JSON.stringify(state),recovered=loadState(raw);
  assert.equal(recovered.error,null);assert.equal(JSON.stringify(recovered.state),raw);
  const exported=createExport(recovered.state,'android','2026-10-12T03:00:00.000Z');
  assert.equal(APP_VERSION,MOBILE_BUILD);assert.equal(exported.appVersion,MOBILE_BUILD);assert.deepEqual(exported.reports,[report]);assert.equal(STORAGE_KEY,'battery-inventory-nfc:diagnostics:v1');
});
