import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as client from '../src/shared/lib/client-utils.js';
import * as age from '../src/shared/lib/battery-age.js';
import * as lifecycle from '../src/shared/lib/battery-lifecycle.js';
import * as movement from '../src/shared/lib/battery-movement-summary.js';

const source = await readFile(new URL('../src/app/battery-usage.jsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions:{ target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext, jsx:ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const jsx = (type, props) => ({ type, props:props || {} });
const bindings = { ...client, ...age, ...lifecycle, ...movement, Pressable:'button', ArrowDownLeft:'icon-in', ArrowUpRight:'icon-out', Clock3:'icon-clock', RefreshCw:'icon-refresh' };
const keys = Object.keys(bindings), BatteryUsage = new Function(...keys, '_jsx', '_jsxs', '_Fragment', `${compiled}\nreturn BatteryUsage;`)(...keys.map(key => bindings[key]), jsx, jsx, 'fragment');
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : tree == null || tree === false ? '' : String(tree);
const battery = { id:'BAT-00000001', name:'Battery', registeredAt:'2025-01-01T00:00:00Z', manufacturedOn:null, firstUsedOn:null, lifecycleStatus:'active', loanId:null };
const usage = { asOf:'2026-10-14T00:00:00Z', totalCheckouts:1201, completedCheckouts:1200, activeCheckouts:1, totalCheckedOutSeconds:1000000, invalidDurationCount:0 };

test('Usage displays complete authoritative totals rather than counting the capped recent records', () => {
  const tree = BatteryUsage({ battery, detail:{ battery, usageSummary:usage, loans:[{}], events:[] }, loading:false });
  assert.deepEqual(nodes(tree).filter(node => node.type === 'dd').slice(0,2).map(text), ['1,201', movement.formatMovementDuration(1000000000)]);
  assert.ok(nodes(tree).some(node => node.props['aria-label'] === '1200 completed checkouts and 1 current checkouts'));
  assert.match(text(tree), /All valid checkout records/);
  assert.match(text(tree), /not measure charge cycles, powered use or battery health/);
  assert.match(text(tree), /Checkouts entered in error are excluded/);
});

test('Usage distinguishes missing totals, zero history, and invalid checkout durations', () => {
  const absent = BatteryUsage({ battery, detail:{ battery }, loading:false });
  assert.match(text(absent), /Usage totals are unavailable/);
  assert.equal(nodes(absent).some(node => node.props.className === 'phone-usage-metrics'), false);
  const empty = BatteryUsage({ battery, detail:{ battery, usageSummary:{ ...usage, totalCheckouts:0, completedCheckouts:0, activeCheckouts:0, totalCheckedOutSeconds:0 } }, loading:false });
  assert.match(text(empty), /No recorded checkouts/);
  assert.deepEqual(nodes(empty).filter(node => node.type === 'dd').slice(0,2).map(text), ['0','0h']);
  const invalid = BatteryUsage({ battery, detail:{ battery, usageSummary:{ ...usage, totalCheckedOutSeconds:null, invalidDurationCount:2 } }, loading:false });
  assert.equal(nodes(invalid).filter(node => node.type === 'dd')[1].props.children, 'Not available');
  assert.match(text(invalid), /2 checkout records have missing or invalid times/);
});

test('refresh retains the dated totals, allows retry after failure, and never implies a live clock', () => {
  let refreshes = 0;
  const props = { battery, detail:{ battery, usageSummary:usage }, onRefresh:() => refreshes++ };
  const loading = BatteryUsage({ ...props, loading:true });
  assert.equal(nodes(loading).find(node => node.props['aria-label'] === 'Refresh usage').props.disabled, true);
  assert.equal(nodes(loading).find(node => node.type === 'time').props.dateTime, usage.asOf);
  const failed = BatteryUsage({ ...props, loading:false, error:new Error('Offline') });
  assert.match(text(failed), /Showing the last loaded usage/);
  const retry = nodes(failed).find(node => node.props['aria-label'] === 'Refresh usage');
  assert.equal(retry.props.disabled, false); retry.props.onClick(); assert.equal(refreshes,1);
});

test('movement visualization shares web correction semantics and does not invent a check-in from registration', () => {
  const loan = { id:'LOAN-1', checkedOutAt:'2026-10-13T00:00:00Z', returnedAt:'2026-10-13T01:00:00Z', cancelledAt:null, borrowerName:'Holder', checkoutActorName:'Operator', returnActorName:'Operator' };
  const corrected = { ...loan, id:'LOAN-2', cancelledAt:'2026-10-13T02:00:00Z' };
  const detail = { battery, usageSummary:usage, movementSummary:{ activeLoan:null, latestReturn:loan, recentLoans:[loan,corrected], registration:{ at:battery.registeredAt, actorName:'Registrar' } } };
  const tree = BatteryUsage({ battery, detail, loading:false });
  const events = nodes(tree).filter(node => node.type === 'li');
  assert.deepEqual(events.map(node => node.props['data-movement']), ['return','checkout','registration']);
  assert.match(text(events[2]), /^Registered/);
  assert.match(text(tree), /Since last recorded return/);
  assert.match(text(tree), /Loan duration · 1h/);
});

test('retired service age is bounded by retirement, and unknown dates stay unknown', () => {
  const tree = BatteryUsage({ battery:{ ...battery, lifecycleStatus:'scrapped', firstUsedOn:'2026-01-01', lifecycleAt:'2026-01-11T00:00:00Z' }, detail:null, loading:false });
  const rows = nodes(tree).find(node => node.props['aria-label'] === 'Age and registration');
  assert.match(text(rows), /Time in service10 days/);
  assert.match(text(rows), /Manufactured onNot recorded/);
  assert.match(text(rows), /Time in service ends at retirement/);
});
