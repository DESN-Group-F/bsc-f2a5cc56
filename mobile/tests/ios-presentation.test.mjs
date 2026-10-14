import test from 'node:test';
import assert from 'node:assert/strict';
import { usesIosPresentation, IOS_MAIN_AREAS, IOS_SCAN_ACTIONS, iosDockPosition, iosSearchDestination, iosRouteTransition } from '../src/app/ios-presentation.mjs';
import { createIosDockMotion } from '../src/app/ios-dock-motion.mjs';
import { createPhoneNavigation } from '../src/app/phone-navigation.mjs';

test('iOS page travel follows admitted push/back and never replays on a retained record update',()=>{
  const navigation=createPhoneNavigation('staff:demo');navigation.activate('inventory');
  const list=navigation.getSnapshot();navigation.rememberScroll(list.current.key,214);
  navigation.push('inventory',{detail:{id:'BAT-1'}});const detail=navigation.getSnapshot();
  assert.match(iosRouteTransition(list,detail).frames[0].transform,/translate3d\(24px/);
  navigation.replace({pageContext:{refreshed:true}});assert.equal(iosRouteTransition(detail,navigation.getSnapshot()),null);
  navigation.back();const restored=navigation.getSnapshot();
  assert.match(iosRouteTransition(detail,restored).frames[0].transform,/translate3d\(-16px/);
  assert.equal(restored.current.key,list.current.key);assert.equal(restored.current.scroll,214);
  navigation.push('me',{page:'messages'},{returnToOrigin:true});const messages=navigation.getSnapshot();
  assert.match(iosRouteTransition(restored,messages).frames[0].transform,/translate3d\(24px/);
  navigation.back();assert.match(iosRouteTransition(messages,navigation.getSnapshot()).frames[0].transform,/translate3d\(-16px/);
});

test('iOS presentation cannot alter native Android through a preview query', () => {
  assert.equal(usesIosPresentation({ native:true, platform:'ios' }),true);
  assert.equal(usesIosPresentation({ native:true, platform:'android', search:'?presentation=ios' }),false);
  assert.equal(usesIosPresentation({ native:false, platform:'web' }),false);
  assert.equal(usesIosPresentation({ native:false, platform:'web', search:'?presentation=ios' }),true);
});
test('four operation entrances preserve independent inventory/workspace destinations', () => {
  assert.deepEqual(IOS_MAIN_AREAS,['scan','inventory','workspace','me']);
  assert.deepEqual(IOS_SCAN_ACTIONS.map(action => action.kind),['return','checkout','intake','removal']);
});

function dockFixture(reduced=false) {
  const styles=()=>({setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}});
  const tabs=Array.from({length:4},()=>({style:styles()})),items=Array.from({length:4},()=>({dataset:{}})),frames=new Map();let sequence=0;
  const bar={clientWidth:370,querySelectorAll:()=>tabs,ownerDocument:{visibilityState:'visible'}},lens={style:styles(),clientHeight:54},optics={style:styles(),children:items};
  const motion=createIosDockMotion({bar,lens,optics,reduced,requestFrame:callback=>{frames.set(++sequence,callback);return sequence;},cancelFrame:id=>frames.delete(id),observeSize:()=>({observe(){},disconnect(){}})});
  function tick(count=1){for(let i=0;i<count;i++)for(const[id,callback]of [...frames]){frames.delete(id);callback((sequence+i+1)*16);}}
  return {motion,frames,bar,lens,optics,tabs,tick};
}
test('approved fluid lens is interruptible, settles without an idle frame loop and paints thin chromatic optics',()=>{
  const f=dockFixture();f.motion.press(1);f.tick(10);assert.ok(Number(f.lens.style['--ios-lens-press'])>0);assert.match(f.lens.style['--ios-edge-width'],/px$/);assert.match(f.optics.style.transform,/matrix/);
  f.motion.drag(1.8,160);f.tick();f.motion.cancel();f.motion.select(2);f.tick(180);assert.equal(f.frames.size,0);assert.equal(f.lens.style['--ios-lens-press'],'0');assert.match(f.lens.style.transform,/translate3d\(180px/);
  f.motion.dispose();assert.equal(f.frames.size,0);assert.equal(Object.hasOwn(f.tabs[0].style,'opacity'),false);
});
test('reduced motion and hidden-page cancellation do not retain a navigation animation',()=>{
  const reduced=dockFixture(true);reduced.motion.press(2);reduced.motion.select(2);assert.equal(reduced.frames.size,0);assert.equal(reduced.lens.style['--ios-lens-press'],'0');reduced.motion.dispose();
  const f=dockFixture();f.motion.press(1);f.tick();f.bar.ownerDocument.visibilityState='hidden';f.motion.cancel();assert.equal(f.frames.size,0);f.motion.dispose();
});
test('dock drag remains bounded and rejects unavailable geometry', () => {
  assert.equal(iosDockPosition(10,10,300),0);
  assert.equal(iosDockPosition(160,10,300),1.5);
  assert.equal(iosDockPosition(410,10,300),3);
  assert.equal(iosDockPosition(0,10,0),null);
  assert.equal(iosDockPosition(NaN,10,300),null);
});
test('search captures the real fixed boundary and only bounded query text', () => {
  for (const kind of ['owner','holder','group','room']) {
    const scope={kind,id:'fixed-boundary'};
    assert.deepEqual(iosSearchDestination({area:'inventory',scope},'  BAT-1  ','request').scope,scope);
    assert.deepEqual(iosSearchDestination({area:'inventory',detail:{scope}},'BAT-1','request').scope,scope);
  }
  assert.equal(iosSearchDestination({area:'scan'},' x '.repeat(100),'r').request.text.length,200);
  assert.equal(iosSearchDestination({area:'me'},'','r').scope,null);
  assert.deepEqual(iosSearchDestination({area:'workspace',detail:{group:{id:'G1',version:4}}},'','r').scope,{kind:'group',id:'G1',version:4,label:'Teaching group'});
});
