import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import * as model from '../src/features/workspace/workspace-model.mjs';
import { workspaceStateKey } from '../src/features/workspace/phone-view-state.mjs';

// The actual phone page owns the inert/visible boundary; its child panels are
// inert React element types here. This does not establish browser blur or focus.
const source = await readFile(new URL('../src/features/workspace/workspace.jsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('workspace.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const imports = {};
for (const statement of parsed.statements.filter(ts.isImportDeclaration)) for (const binding of statement.importClause?.namedBindings?.elements ?? []) imports[binding.name.text] = binding.name.text;
const code = ts.transpileModule(parsed.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getFullText(parsed)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
function mount(view = 'messages', initialTaskContext = null) {
  const states = []; let pointer = 0;
  const state = initial => { const key = pointer++; if (!(key in states)) states[key] = typeof initial === 'function' ? initial() : initial; return [states[key], next => { states[key] = typeof next === 'function' ? next(states[key]) : next; }]; };
  const bindings = { ...imports, ...model, workspaceStateKey, usePhoneBack() {}, useEffect() {}, usePhoneViewState: (key, field, initial) => state(initial), useCallback: callback => callback, useState: state };
  const keys = Object.keys(bindings), Component = new Function(...keys, '_jsx', '_jsxs', '_Fragment', `${code}\nreturn WorkspacePage;`)(...keys.map(key => bindings[key]), jsx, jsxs, Fragment);
  const props = { view, data: { user: { id: 'review-account', role: 'staff' }, dataset: 'demo' }, user: { id: 'review-account', role: 'staff' }, dataset: 'demo', initialTaskContext };
  return { render(patch = {}) { Object.assign(props, patch); pointer = 0; return Component(props); } };
}
function find(tree, type) {
  if (Array.isArray(tree)) return tree.map(child => find(child, type)).find(Boolean);
  if (!tree || typeof tree !== 'object') return undefined;
  return tree.type === type ? tree : find(tree.props?.children, type);
}

test('a retained source page stays visible and inert while its primary panel remains inactive', () => {
  const view = mount();
  const active = view.render({ active: true }); assert.equal(active.props.hidden, false); assert.equal(active.props.inert, undefined);
  const backdrop = view.render({ active: false, backdropVisible: true });
  assert.equal(backdrop.props.hidden, false); assert.equal(backdrop.props.inert, true); assert.equal(find(backdrop, 'MobileMessages').props.active, false);
  const restored = view.render({ active: true, backdropVisible: false });
  assert.equal(restored.props.hidden, false); assert.equal(restored.props.inert, undefined); assert.equal(find(restored, 'MobileMessages').props.active, true);
});

for (const [route, panel, taskContext] of [['messages', 'MobileMessages', 'open'], ['task-plans', 'MobileTasks', null]]) test(`opened ${route} retains its native page while hidden or visible as an inactive backdrop`, () => {
  const view = mount(route, taskContext), active = view.render({ active: true });
  assert.equal(active.props.hidden, false); assert.equal(active.props.inert, undefined); assert.equal(find(active, panel).props.active, true);
  if (taskContext) { assert.equal(active.props['aria-label'], 'My tasks'); assert.equal(find(active, panel).props.initialTaskContext, 'open'); }
  const backdrop = view.render({ active: false, backdropVisible: true });
  assert.equal(backdrop.props.hidden, false); assert.equal(backdrop.props.inert, true); assert.equal(find(backdrop, panel).props.active, false);
  const hidden = view.render({ active: false, backdropVisible: false });
  assert.equal(hidden.props.hidden, true); assert.equal(hidden.props.inert, true); assert.equal(find(hidden, panel).props.active, false);
  const restored = view.render({ active: true, backdropVisible: false });
  assert.equal(restored.props.inert, undefined); assert.equal(find(restored, panel).props.active, true);
  assert.equal(find(restored, 'MessagesPanel'), undefined, 'Phone routes no longer open a whole shared web panel by default');
});
