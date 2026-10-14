import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { enAU } from 'react-day-picker/locale';
import * as temporal from '../src/shared/lib/temporal-input.js';

const jsx = (type, props) => ({ type, props }), nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
async function compile(relative, name, bindings) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export\s*\{[^}]*\};?\r?\n?/gm, '').replace(/^export /gm, '');
  const keys = Object.keys(bindings);
  return new Function(...keys, '_jsx', '_jsxs', `${code}\nreturn ${name};`)(...keys.map(key => bindings[key]), jsx, jsx);
}

test('canonical PopoverContent preserves default body portal and passes an optional host only to Portal', async () => {
  const PopoverContent = await compile('../../components/ui/popover.tsx', 'PopoverContent', { React: {}, PopoverPrimitive: { Portal: 'Portal', Content: 'Content' }, cn: (...values) => values.filter(Boolean).join(' ') });
  const standard = PopoverContent({ children: 'Web content' });
  assert.equal(standard.type, 'Portal'); assert.equal(standard.props.container, undefined); assert.equal(standard.props.children.props.align, 'center'); assert.equal(standard.props.children.props.sideOffset, 4);
  const dialog = { tagName: 'DIALOG' }, hosted = PopoverContent({ portalContainer: dialog, align: 'start', children: 'Phone content' });
  assert.equal(hosted.props.container, dialog); assert.equal(hosted.props.children.props.align, 'start');
  assert.equal(Object.hasOwn(hosted.props.children.props, 'portalContainer'), false);
});

async function temporalView(extra = {}) {
  const React = { useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}], useRef: value => ({ current: value }), useEffect() {} };
  const bindings = { React, enAU, ...temporal, currentSydneyDate: () => '2026-10-12', ...Object.fromEntries(['CalendarDays', 'Clock', 'Button', 'Calendar', 'Popover', 'PopoverContent', 'PopoverTrigger'].map(name => [name, name])) };
  const TemporalInput = await compile('../../components/ui/temporal-input.tsx', 'TemporalInput', bindings);
  let changed;
  const tree = TemporalInput({ type: 'date', value: '2026-10-12', 'aria-label': 'Latest checkout minimum', onChange: event => { changed = event.target.value; }, ...extra });
  const field = nodes(tree).find(node => node.type === 'input');
  class NativeInput {
    set value(next) { this.content = next; } get value() { return this.content; }
    dispatchEvent(event) { Object.defineProperty(event, 'target', { value: this }); field.props.onChange(event); }
  }
  const element = new NativeInput(); element.ownerDocument = { defaultView: { HTMLInputElement: NativeInput, Event } }; field.props.ref(element);
  return { tree, field, element, changed: () => changed };
}

test('canonical TemporalInput keeps the English chooser and optional host off the real input DOM props', async () => {
  for (const portalContainer of [undefined, { tagName: 'DIALOG' }]) {
    const view = await temporalView({ portalContainer });
    assert.equal(view.field.props.type, 'text'); assert.equal(view.tree.props.lang, 'en-AU'); assert.equal(Object.hasOwn(view.field.props, 'portalContainer'), false);
    const popup = nodes(view.tree).find(node => node.type === 'PopoverContent'), calendar = nodes(view.tree).find(node => node.type === 'Calendar');
    assert.equal(popup.props.portalContainer, portalContainer); assert.equal(popup.props.lang, 'en-AU'); assert.equal(calendar.props.locale, enAU);
    assert.equal(calendar.props.locale.localize.month(0, { width: 'wide' }), 'January'); assert.equal(view.changed(), undefined);
    calendar.props.onSelect(temporal.toCalendarDate('2026-10-13')); assert.equal(view.changed(), '2026-10-13');
  }
});

test('optional calendar host does not bypass disabled or read-only input guards', async () => {
  for (const guard of [{ disabled: true }, { readOnly: true }]) {
    const view = await temporalView({ portalContainer: { tagName: 'DIALOG' }, ...guard });
    nodes(view.tree).find(node => node.type === 'Calendar').props.onSelect(temporal.toCalendarDate('2026-10-13'));
    nodes(view.tree).find(node => node.type === 'Button' && node.props.children === 'Clear').props.onClick();
    assert.equal(view.changed(), undefined); assert.equal(nodes(view.tree).find(node => node.type === 'Popover').props.open, false);
  }
});

test('optional picker presentation reaches PopoverContent without changing native input or English selection semantics', async () => {
  const boundary = { tagName: 'DIALOG' }, pickerContentProps = { collisionBoundary: boundary, collisionPadding: 8, sticky: 'always', updatePositionStrategy: 'always', className: 'mi-mobile-date-picker' };
  const phone = await temporalView({ portalContainer: boundary, pickerContentProps });
  const popup = nodes(phone.tree).find(node => node.type === 'PopoverContent');
  assert.equal(Object.hasOwn(phone.field.props, 'pickerContentProps'), false);
  assert.equal(popup.props.collisionBoundary, boundary); assert.equal(popup.props.collisionPadding, 8);
  assert.equal(popup.props.sticky, 'always'); assert.equal(popup.props.updatePositionStrategy, 'always');
  assert.equal(popup.props.className, 'temporal-picker mi-mobile-date-picker'); assert.equal(popup.props.lang, 'en-AU');
  nodes(phone.tree).find(node => node.type === 'Calendar').props.onSelect(temporal.toCalendarDate('2026-10-13'));
  assert.equal(phone.changed(), '2026-10-13');
  const standard = await temporalView(), standardPopup = nodes(standard.tree).find(node => node.type === 'PopoverContent');
  assert.equal(standardPopup.props.className, 'temporal-picker');
  assert.equal(standardPopup.props.collisionBoundary, undefined); assert.equal(standardPopup.props.collisionPadding, undefined);
  for (const guard of [{ disabled: true }, { readOnly: true }]) {
    const locked = await temporalView({ portalContainer: boundary, pickerContentProps, ...guard });
    nodes(locked.tree).find(node => node.type === 'Calendar').props.onSelect(temporal.toCalendarDate('2026-10-13'));
    assert.equal(locked.changed(), undefined);
  }
});
