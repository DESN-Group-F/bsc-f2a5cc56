import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneViewportStore } from '../src/app/phone-viewport.js';
import { phoneViewportLayout, phoneFocusScrollAdjustment } from '../src/app/phone-layout.mjs';

function surface() {
  const win=new EventTarget(),viewport=new EventTarget(),document=new EventTarget(),media=new EventTarget(),frames=new Map();let frame=0;
  const node=()=>({dataset:{},attributes:new Map(),getAttribute(name){return this.attributes.get(name)??null;},setAttribute(name,value){this.attributes.set(name,value);},removeAttribute(name){this.attributes.delete(name);}});
  const root=node(),body=node(),styles=new Map();root.style={getPropertyValue:key=>styles.get(key)||'',setProperty:(key,value)=>styles.set(key,value),removeProperty:key=>styles.delete(key)};
  Object.assign(document,{documentElement:root,body,activeElement:null});Object.assign(viewport,{width:412,height:828,scale:1});Object.assign(media,{matches:false});
  Object.assign(win,{document,visualViewport:viewport,innerWidth:412,innerHeight:828,matchMedia:()=>media,requestAnimationFrame:callback=>{frames.set(++frame,callback);return frame;},cancelAnimationFrame:id=>frames.delete(id)});
  return{win,viewport,document,media,styles,frames,flush(){const current=[...frames.values()];frames.clear();current.forEach(callback=>callback());}};
}

test('focus and viewport scroll retain snapshot identity when geometry is unchanged', () => {
  const fixture=surface(),store=createPhoneViewportStore(fixture.win);let changes=0;const stop=store.subscribe(()=>changes++),original=store.getSnapshot();
  fixture.document.dispatchEvent(new Event('focusin'));fixture.viewport.dispatchEvent(new Event('scroll'));
  assert.equal(changes,0);assert.equal(store.getSnapshot(),original);assert.equal(fixture.frames.size,1);stop();
});

test('keyboard and rotation expose a short editing surface without recreating task state', () => {
  const fixture=surface(),store=createPhoneViewportStore(fixture.win);const stop=store.subscribe(()=>{});
  fixture.document.activeElement={matches:()=>true,closest:()=>null,parentElement:null,nodeType:1};
  fixture.viewport.height=540;fixture.win.innerHeight=540;fixture.viewport.dispatchEvent(new Event('resize'));
  assert.equal(store.getSnapshot().keyboardOpen,true);assert.equal(store.getSnapshot().layout,'editing');
  fixture.viewport.width=828;fixture.viewport.height=175;fixture.win.innerWidth=828;fixture.win.innerHeight=175;fixture.win.dispatchEvent(new Event('orientationchange'));
  assert.equal(store.getSnapshot().layout,'editing');assert.equal(fixture.styles.get('--phone-viewport-height'),'175px');
  fixture.document.activeElement=null;fixture.viewport.height=388;fixture.win.innerHeight=388;fixture.viewport.dispatchEvent(new Event('resize'));
  assert.equal(store.getSnapshot().layout,'wide');assert.equal(store.getSnapshot().keyboardOpen,false);stop();
});

test('focus transfers to a checkbox or action retain editing until the measured keyboard viewport restores',()=>{
  for(const target of ['checkbox','button']){
    const fixture=surface();fixture.viewport.width=828;fixture.viewport.height=388;fixture.win.innerWidth=828;fixture.win.innerHeight=388;
    const store=createPhoneViewportStore(fixture.win);let changes=0;const stop=store.subscribe(()=>changes++);
    fixture.document.activeElement={matches:()=>true,closest:()=>null};fixture.document.dispatchEvent(new Event('focusin'));
    fixture.viewport.height=175;fixture.win.innerHeight=175;fixture.viewport.dispatchEvent(new Event('resize'));
    const editing=store.getSnapshot();changes=0;assert.equal(editing.keyboardOpen,true);
    fixture.document.activeElement=null;fixture.document.dispatchEvent(new Event('focusout'));
    assert.equal(store.getSnapshot(),editing,'Losing input focus must not move the pressed target before click');
    fixture.document.activeElement={type:target,matches:()=>false};fixture.document.dispatchEvent(new Event('focusin'));
    assert.equal(store.getSnapshot(),editing);assert.equal(changes,0);assert.equal(fixture.document.body.dataset.phoneLayout,'editing');assert.equal(fixture.document.documentElement.dataset.phoneLayout,'editing');
    for(const height of [260,300,340]){
      fixture.viewport.height=height;fixture.win.innerHeight=height;fixture.viewport.dispatchEvent(new Event('resize'));
      assert.equal(store.getSnapshot().layout,'editing','A partly restored keyboard animation still owns reduced screen space');
    }
    fixture.viewport.height=388;fixture.win.innerHeight=388;fixture.viewport.dispatchEvent(new Event('resize'));
    assert.equal(store.getSnapshot().layout,'wide');assert.equal(store.getSnapshot().keyboardOpen,false);
    fixture.document.activeElement={matches:()=>true,closest:()=>null};fixture.document.dispatchEvent(new Event('focusin'));fixture.viewport.height=175;fixture.win.innerHeight=175;fixture.viewport.dispatchEvent(new Event('resize'));
    assert.equal(store.getSnapshot().layout,'editing','The original expanded baseline was not overwritten on focusout');stop();
  }
});

test('portrait keyboard focusout preserves its normal baseline when innerHeight also shrinks',()=>{
  const fixture=surface(),store=createPhoneViewportStore(fixture.win),stop=store.subscribe(()=>{});
  fixture.document.activeElement={matches:()=>true,closest:()=>null};fixture.viewport.height=540;fixture.win.innerHeight=540;fixture.viewport.dispatchEvent(new Event('resize'));
  fixture.document.activeElement=null;fixture.document.dispatchEvent(new Event('focusout'));assert.equal(store.getSnapshot().layout,'editing');
  fixture.viewport.height=760;fixture.win.innerHeight=760;fixture.viewport.dispatchEvent(new Event('resize'));assert.equal(store.getSnapshot().layout,'editing');
  fixture.viewport.height=828;fixture.win.innerHeight=828;fixture.viewport.dispatchEvent(new Event('resize'));assert.equal(store.getSnapshot().layout,'portrait');assert.equal(store.getSnapshot().keyboardOpen,false);stop();
});

test('an ordinary short noneditable window or zoom does not create a retained keyboard state',()=>{
  assert.equal(phoneViewportLayout({width:828,height:175,baselineHeight:388,editable:false}).layout,'wide');
  assert.equal(phoneViewportLayout({width:828,height:175,baselineHeight:388,keyboardHeld:true,scale:2}).keyboardOpen,false);
  assert.equal(phoneViewportLayout({width:828,height:387,baselineHeight:388,keyboardHeld:true}).layout,'wide','Pixel rounding is allowed at restored geometry');
});

test('root and shell subscriptions share listeners and cleanup only after the last owner leaves', () => {
  const fixture=surface(),store=createPhoneViewportStore(fixture.win);let first=0,second=0;
  const stopFirst=store.subscribe(()=>first++),stopSecond=store.subscribe(()=>second++);assert.equal(createPhoneViewportStore(fixture.win),store);
  first=0;second=0;fixture.viewport.width=640;fixture.viewport.height=360;fixture.win.innerWidth=640;fixture.win.innerHeight=360;fixture.viewport.dispatchEvent(new Event('resize'));
  assert.equal(first,1);assert.equal(second,1);stopFirst();assert.equal(fixture.styles.get('--phone-viewport-width'),'640px');
  stopSecond();assert.equal(fixture.styles.has('--phone-viewport-width'),false);
});

test('system reduced motion is known in the initial snapshot and only real preference changes notify', () => {
  const fixture=surface();fixture.media.matches=true;const store=createPhoneViewportStore(fixture.win);assert.equal(store.getSnapshot().systemReduced,true);
  let changes=0;const stop=store.subscribe(()=>changes++);fixture.media.dispatchEvent(new Event('change'));assert.equal(changes,0);
  fixture.media.matches=false;fixture.media.dispatchEvent(new Event('change'));assert.equal(changes,1);assert.equal(store.getSnapshot().systemReduced,false);stop();
});

test('focus adjustment stays within its actual body and never moves an unscrollable tiny owner', () => {
  assert.equal(phoneFocusScrollAdjustment({fieldTop:239,fieldBottom:283,ownerTop:44,ownerBottom:160,viewportBottom:175}),135);
  assert.equal(phoneFocusScrollAdjustment({fieldTop:80,fieldBottom:124,ownerTop:44,ownerBottom:160,viewportBottom:175}),0);
  assert.equal(phoneFocusScrollAdjustment({fieldTop:239,fieldBottom:283,ownerTop:168,ownerBottom:178,viewportBottom:175}),0);
  assert.equal(phoneViewportLayout({width:828,height:175,editable:true}).layout,'editing');
});
