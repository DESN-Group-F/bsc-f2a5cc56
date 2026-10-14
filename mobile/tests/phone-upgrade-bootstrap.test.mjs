import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import postcss from 'postcss';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Battery } from 'lucide-react';
import ts from 'typescript';
import { startupPresentation } from '../src/app/startup-state.mjs';

// These check the document that exists before JavaScript, not native frame timing.
const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
const phoneCss = postcss.parse(await readFile(new URL('../src/app/phone.css',import.meta.url),'utf8'));
const critical = postcss.parse(html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '');
const normalize = value => value.replace(/\s+/g,'').toLowerCase();
const rule = (sheet,selector,property) => {
  const found = sheet.nodes.find(node => node.type === 'rule' && node.selectors.includes(selector) && (!property || node.nodes.some(item => item.type === 'decl' && item.prop === property)));
  assert.ok(found,`Missing presentation rule ${selector}`);return found;
};
const declaration = (node,name) => {
  const found = node.nodes.find(item => item.type === 'decl' && item.prop === name);
  assert.ok(found,`Missing ${name}`);return found.value;
};

test('the initial document presents the actual accessible opening state without executing its module',() => {
  const withoutScript = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
  const opening = startupPresentation({phase:'opening'});
  assert.match(withoutScript,/<div id="root">\s*<div class="phone-app" data-initial-startup>/);
  assert.ok(withoutScript.includes(`<h1>${opening.title}</h1><p>${opening.detail}</p>`));
  assert.match(withoutScript,/<section[^>]*aria-busy="true"[^>]*data-startup-phase="opening"/);
  assert.match(withoutScript,/<div class="phone-startup-status" role="status" aria-live="polite">/);
  assert.match(withoutScript,/<span class="phone-startup-progress" aria-hidden="true">/);
  assert.doesNotMatch(withoutScript,/aria-valuenow|role="progressbar"|<form|<button|<iframe|onload=|onclick=/);
  const initialIcon = withoutScript.match(/<div class="phone-startup-identity"[^>]*>\s*(<svg\b[\s\S]*?<\/svg>)/)?.[1];
  assert.ok(initialIcon,'The Android/general startup retains its existing identity element.');
  const reactIcon = renderToStaticMarkup(React.createElement(Battery,{size:32}));
  assert.deepEqual(initialIcon.match(/<(?:path|rect)\b[^>]*>/g),reactIcon.match(/<(?:path|rect)\b[^>]*>/g),'HTML and React retain the same existing battery identity geometry.');
});

test('critical styling preserves the Android/general startup without a second fade or wait, with motion scoped to iOS',() => {
  assert.doesNotMatch(critical.toString(),/@import|url\(/);
  critical.walkRules(node => {
    if (node.parent.type === 'atrule' && node.parent.name === 'keyframes') return;
    const iosOnly = node.selectors.every(selector => selector.startsWith('html[data-ios-presentation=true]'));
    if (!iosOnly) assert.doesNotMatch(node.toString(),/animation|transition|visibility:\s*hidden|opacity:\s*0/,'General startup must stay visible without a motion delay.');
    node.walkDecls(/^animation/,() => assert.ok(iosOnly && node.selectors.every(selector => selector.includes('.ios-early-mark')),'Only explicitly selected iOS launch artwork may animate.'));
  });
  const palette = rule(phoneCss,'.phone-app','background');
  const tokens = rule(phoneCss,'.phone-app','--phone-surface');
  // The palette and tokens are separate rules; use the selector list for tokens.
  assert.equal(declaration(palette,'background'),'var(--phone-surface)');
  assert.equal(declaration(rule(critical,'html'),'background'),declaration(tokens,'--phone-surface'));
  const initial = rule(critical,'[data-initial-startup] .phone-startup');
  for (const property of ['min-height','overflow','width','max-width','margin-inline','padding']) {
    assert.equal(normalize(declaration(initial,property)),normalize(declaration(rule(phoneCss,'.phone-startup'),property)));
  }
  const initialIdentity = rule(critical,'[data-initial-startup] .phone-startup-identity');
  assert.equal(declaration(initialIdentity,'background'),declaration(tokens,'--phone-selected'));
  assert.equal(declaration(initialIdentity,'color'),declaration(tokens,'--phone-blue'));
  assert.equal(rule(phoneCss,'.phone-startup','display').nodes.some(node => node.type === 'decl' && node.prop === 'animation'),false,'React cannot fade out the already-visible starting state.');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.filter(([,attributes]) => /type="module"/.test(attributes)).length,1);
  assert.match(html,/<script type="module" src="\/src\/main\.jsx"><\/script>/);
  const inline = scripts.filter(([,attributes]) => !/type="module"/.test(attributes));
  for (const [platform,native,search,expectedIos] of [['android',true,'?presentation=ios',false],['web',false,'',false],['ios',true,'',true],['web',false,'?presentation=ios',true]]) {
    const document = { documentElement:{dataset:{}},body:{dataset:{}},querySelector:() => theme };
    const theme = { content:declaration(rule(critical,'html'),'background') };
    const context = { document,window:{Capacitor:{isNativePlatform:() => native,getPlatform:() => platform}},location:{protocol:'https:',search},URLSearchParams };
    // Only synchronous selection may precede the module; no timers or network are provided.
    for (const [,attributes,code] of inline) { assert.doesNotMatch(attributes,/\bsrc=/);runInNewContext(code,context,{timeout:1000}); }
    assert.equal(document.documentElement.dataset.iosPresentation,expectedIos?'true':undefined);
    assert.equal(document.body.dataset.iosPresentation,expectedIos?'true':undefined);
    assert.equal(theme.content,expectedIos?'#10141b':declaration(rule(critical,'html'),'background'));
  }
});

test('React takes over the same root immediately and Android uses the matching WebView background',async() => {
  const entry = await readFile(new URL('../src/main.jsx',import.meta.url),'utf8');
  const source = ts.createSourceFile('main.jsx',entry,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
  const mount = source.statements.find(statement => ts.isExpressionStatement(statement) && statement.getText(source).startsWith('createRoot('));
  assert.ok(mount,'React must mount immediately in a top-level expression.');
  const calls = [],root = {},document = {getElementById(id){assert.equal(id,'root');calls.push('root');return root;}};
  const MobileApp = () => null;
  const mountCode = ts.transpileModule(mount.getText(source),{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(mountCode,{
    document,React,MobileApp,
    activateIosPresentation(value){assert.equal(value,document);calls.push('presentation');},
    createRoot(value){assert.equal(value,root);calls.push('createRoot');return{render(element){assert.equal(element.type,MobileApp);calls.push('render');}};},
  },{timeout:1000});
  assert.deepEqual(calls,['presentation','root','createRoot','render'],'Presentation selection and mounting are synchronous and retain the same root.');
  const configSource = await readFile(new URL('../capacitor.config.ts',import.meta.url),'utf8');
  const compiled = ts.transpileModule(configSource,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/export default config;\s*$/,'return config;');
  const config = new Function(compiled)();
  assert.equal(config.android.backgroundColor,declaration(rule(critical,'html'),'background'));
  assert.equal(config.android.loggingBehavior,'none');
});
