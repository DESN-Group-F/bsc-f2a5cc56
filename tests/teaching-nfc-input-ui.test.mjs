import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { validateTeachingNfcTag } from '../work/qa/teaching-nfc.mjs';

// Actual component handlers with controlled hooks and adapters. No physical reader.
const source = await readFile(new URL('../components/inventory/teaching-nfc-input.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(item => nodes(item, result)); else if (node && typeof node === 'object') { result.push(node); nodes(node.props?.children, result); } return result; }
function text(node) { if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(text).join(''); return node && typeof node === 'object' ? text(node.props?.children) : ''; }
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && text(node) === label);
function mount(bridge, props) {
    const state = [], effects = [];
    let pointer = 0, effectPointer = 0, scheduled = [];
    const hooks = {
        useState(initial) { const index = pointer++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
        useRef(initial) { const index = pointer++; if (!(index in state)) state[index] = { current: initial }; return state[index]; },
        useEffect(callback, dependencies) { const index = effectPointer++, prior = effects[index]; if (!prior || dependencies.some((value, key) => !Object.is(value, prior.dependencies[key]))) scheduled.push(() => { prior?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() }; }); },
    };
    const bindings = { ...hooks, Radio: 'Radio', ScanLine: 'ScanLine', Button: 'Button', Input: 'Input', Label: 'Label', teachingNfcBridge: () => bridge, validateTeachingNfcTag };
    const names = Object.keys(bindings), Component = new Function(...names, '_jsx', '_jsxs', '_Fragment', compiled + '\nreturn TeachingNfcInput;')(...names.map(name => bindings[name]), jsx, jsx, 'Fragment');
    return {
        render() { pointer = 0; effectPointer = 0; scheduled = []; const tree = Component(props); for (const effect of scheduled) effect(); return tree; },
        unmount() { effects.forEach(effect => effect?.cleanup?.()); },
    };
}
const proposal = () => ({ attemptId: '11111111-1111-4111-8111-111111111111', source: 'native-nfc-reader', platform: 'ios', startedAt: '2026-10-08T05:00:00.000Z', endedAt: '2026-10-08T05:00:01.000Z', tagId: 'nfc:uid:0004AB00', result: { uidHex: '0004AB00', technology: 'Controlled NFC-A output', ndefStatus: 'notSupported', capacityBytes: null, records: [], observedAt: '2026-10-08T05:00:01.000Z' } });
const available = async () => ({ available: true, enabled: true, platform: 'ios' });

test('browser typed teaching input preserves exact keyboard tag attribution without a native control', async () => {
    const chosen = [], view = mount(null, { onChooseTag: (tag, source) => chosen.push({ tag, source }) });
    assert.match(text(view.render()), /typed tag input, without hardware evidence/);
    assert.equal(button(view.render(), 'Read NFC tag'), undefined);
    const enter = value => { nodes(view.render()).find(node => node.type === 'Input').props.onChange({ target: { value } }); return button(view.render(), 'Find registered tag').props.onClick(); };
    await enter('nfc:uid:0004AB00');
    assert.deepEqual(chosen, [{ tag: 'nfc:uid:0004AB00', source: { kind: 'tag' } }]);
    await enter(' nfc:uid:0004AB00'); assert.equal(chosen.length, 1); assert.match(text(view.render()), /without surrounding spaces/);
    view.unmount();
});

test('browser native selection exposes no typed fallback or reader control until the parent explicitly changes source', async () => {
    const chosen = [], props = { source: 'native_nfc', onChooseTag: (tag, source) => chosen.push({ tag, source }) }, view = mount(null, props);
    assert.match(text(view.render()), /Native NFC is unavailable in this browser/);
    assert.match(text(view.render()), /Choose Entered tag or Inventory selection above/);
    assert.equal(nodes(view.render()).some(node => node.type === 'Input'), false);
    assert.equal(button(view.render(), 'Read NFC tag'), undefined);
    assert.equal(button(view.render(), 'Find registered tag'), undefined);
    assert.equal(chosen.length, 0);
    props.source = 'tag'; view.render();
    nodes(view.render()).find(node => node.type === 'Input').props.onChange({ target: { value: 'nfc:uid:01020304' } });
    await button(view.render(), 'Find registered tag').props.onClick();
    assert.deepEqual(chosen, [{ tag: 'nfc:uid:01020304', source: { kind: 'tag' } }]);
    view.unmount();
});

test('controlled native read stages a proposal; explicit adoption alone calls the alternative selector', async () => {
    const chosen = [], busy = [], value = proposal(); let adopts = 0;
    const bridge = { getAvailability: available, read: async () => value, cancel: async () => {}, adopt: async adopted => { adopts++; assert.deepEqual(adopted, value); return { ...adopted, adoptedAt: '2026-10-08T05:00:03.000Z' }; } };
    const view = mount(bridge, { source: 'native_nfc', onChooseTag: (tag, source) => chosen.push({ tag, source }), onBusyChange: value => busy.push(value) });
    view.render(); await Promise.resolve();
    await button(view.render(), 'Read NFC tag').props.onClick();
    assert.equal(chosen.length, 0); assert.equal(adopts, 0); assert.match(text(view.render()), /This read has not selected or borrowed a battery/);
    await button(view.render(), 'Use identifier as manual alternative input').props.onClick();
    assert.equal(adopts, 1); assert.equal(chosen.length, 1); assert.equal(chosen[0].source.kind, 'native_nfc');
    assert.deepEqual(chosen[0].source.evidence.result, value.result); assert.equal(chosen[0].source.evidence.tagId, chosen[0].tag);
    assert.equal(button(view.render(), 'Use identifier as manual alternative input'), undefined); assert.ok(busy.includes(true));
    view.unmount();
});

test('unknown inventory or explicit-source mismatch keeps the proposal and failed reads never select a battery', async () => {
    const value = proposal(); let calls = 0;
    const bridge = { getAvailability: available, read: async () => value, cancel: async () => {}, adopt: async adopted => ({ ...adopted, adoptedAt: '2026-10-08T05:00:03.000Z' }) };
    const view = mount(bridge, { source: 'native_nfc', onChooseTag: () => { calls++; throw new Error('Controlled unknown tag or source switch required'); } });
    view.render(); await Promise.resolve(); await button(view.render(), 'Read NFC tag').props.onClick();
    await button(view.render(), 'Use identifier as manual alternative input').props.onClick();
    assert.equal(calls, 1); assert.match(text(view.render()), /Controlled unknown tag/); assert.ok(button(view.render(), 'Use identifier as manual alternative input'));
    button(view.render(), 'Discard identifier proposal').props.onClick(); assert.equal(calls, 1);
    bridge.read = async () => { throw new Error('Controlled read failure'); };
    await button(view.render(), 'Read NFC tag').props.onClick(); assert.equal(calls, 1); assert.match(text(view.render()), /Controlled read failure/);
    view.unmount();
});

test('controlled NFC cancellation unlocks the reader without selecting or committing a battery', async () => {
    let rejectRead, selected = 0, cancels = 0;
    const bridge = { getAvailability: available, read: () => new Promise((_, reject) => { rejectRead = reject; }), cancel: async () => { cancels++; rejectRead(new Error('Controlled cancellation')); }, adopt: async () => { throw new Error('No read'); } };
    const view = mount(bridge, { source: 'native_nfc', onChooseTag: () => { selected++; } }); view.render(); await Promise.resolve();
    const reading = button(view.render(), 'Read NFC tag').props.onClick();
    assert.equal(button(view.render(), 'Reading NFC…').props.disabled, true);
    await button(view.render(), 'Cancel NFC read').props.onClick(); await reading;
    assert.equal(cancels, 1); assert.equal(selected, 0); assert.match(text(view.render()), /Controlled cancellation/);
    assert.equal(button(view.render(), 'Read NFC tag').props.disabled, false);
    view.unmount();
});
