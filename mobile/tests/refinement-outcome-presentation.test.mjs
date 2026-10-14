import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const nodes=(node,list=[])=>{if(!node||typeof node!=='object')return list;if(node.type)list.push(node);for(const child of [node.props?.children].flat(Infinity))nodes(child,list);return list;};
const text=node=>node==null||typeof node==='boolean'?'':typeof node!=='object'?String(node):[node.props?.children].flat(Infinity).map(text).join('');
async function outcomeHarness(props={},reduced=false){
  const hooks=[],effects=[],animations=[],transitions=[],listeners=new Map(),elements=new Map(),focusLog=[],parent={inert:false};let cursor=0,dirty=true,tree,back;
  const document={body:{},activeElement:null,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
  const element=node=>{const identity=node.props['aria-label']||`${node.type}:${text(node)}`;if(!elements.has(identity))elements.set(identity,{identity,closest:()=>parent,getClientRects:()=>[{}],focus(){document.activeElement=this;focusLog.push(this);}});return elements.get(identity);};
  const dialogControls=()=>nodes(nodes(tree).find(node=>node.props.role==='dialog')).filter(node=>node.type==='button'&&!node.props.disabled||node.type==='summary').map(element);
  const effect=(run,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((value,index)=>!Object.is(value,old.deps[index]))){hooks[i]={deps,cleanup:old?.cleanup};effects.push(()=>{hooks[i].cleanup?.();hooks[i].cleanup=run();});}};
  const bindings={React:{},_Fragment:'fragment',...Object.fromEntries(['AlertCircle','CheckCircle2','Copy','Info','Nfc','Pause','Search'].map(name=>[name,name])),useId:()=> 'outcome-test',usePhoneReducedMotion:()=>reduced,usePhoneBack:(callback,options)=>{if(options.enabled)back=callback;},usePhoneOverlayDismiss(){},createPhoneWorkflowPortal:node=>node,PhoneDialogHeader:'header',PhoneDialogBody:'body',PhoneDialogActions:'footer',Pressable:'button',document,
    useState(initial){const i=cursor++;hooks[i]??={value:typeof initial==='function'?initial():initial};return[hooks[i].value,value=>{hooks[i].value=typeof value==='function'?value(hooks[i].value):value;dirty=true;}];},useRef(initial){return hooks[cursor++]??={current:initial};},useEffect:effect};
  props={...props,onOpenChange:open=>transitions.push(open)};
  const source=ts.transpileModule(await readFile(new URL('../src/features/scan/outcome-status.jsx',import.meta.url),'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),keys=Object.keys(bindings),jsx=(type,props)=>({type,props}),Component=new Function(...keys,'_jsx','_jsxs',source+'\nreturn ScanOutcomeStatus;')(...keys.map(key=>bindings[key]),jsx,jsx);
  function render(patch={}){props={...props,...patch};let attempts=0;do{assert.ok(attempts++<15);dirty=false;cursor=0;tree=Component(props);for(const node of nodes(tree))if(node.props.ref&&!node.props.ref.current)node.props.ref.current=Object.assign(element(node),{querySelector:()=>dialogControls().find(control=>control.identity==='button:Close message'),querySelectorAll:dialogControls,animate(frames,options){const animation={frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(animation);return animation;}});while(effects.length)effects.shift()();}while(dirty);}
  render();return{render,nodes:()=>nodes(tree),text:()=>text(tree),parent,transitions,animations,focusLog,activeElement:()=>document.activeElement,control:label=>element(nodes(tree).find(node=>node.type==='button'&&text(node)===label||node.type==='summary'&&text(node)===label||node.props['aria-label']===label)),key(key,shiftKey=false){const event={key,shiftKey,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};listeners.get('keydown')?.(event);render();return event;},open(){const node=nodes(tree).find(node=>node.props['aria-label']==='Read complete scan message');element(node).focus();node.props.onClick();render();},close(){nodes(tree).find(node=>node.type==='button'&&text(node)==='Close message').props.onClick();render();},back:()=>{back();render();},unmount(){for(const hook of hooks)hook.cleanup?.();}};
}
test('every outcome retains one anchored reserve and a deliberately cleared acquisition cannot reappear on pause',async()=>{
  const view=await outcomeHarness({feedback:{sequence:1,outcomeType:'failure',tone:'failure',message:'Previous unknown tag'},reader:{state:'starting',message:'Preparing a new reader'}});
  assert.equal(view.nodes().filter(node=>node.props.className==='scan-outcome-reserve').length,1);assert.match(view.text(),/Preparing NFC readerPreparing a new reader/);assert.doesNotMatch(view.text(),/Checking tag|Previous unknown tag/);assert.equal(view.nodes().find(node=>node.props.className==='scan-outcome-card').props['data-pulse'],undefined);
  view.render({feedback:{sequence:1,outcomeType:'',message:''},reader:{state:'paused',message:'App is in the background'}});assert.match(view.text(),/Reading pausedApp is in the background/);assert.equal(view.nodes().find(node=>node.props.className==='scan-outcome-card').props['data-pulse'],undefined);view.unmount();
});
test('accepted and duplicate show distinct designed outcomes without moving the reserved lane',async()=>{
  const view=await outcomeHarness({feedback:{sequence:1,outcomeType:'accepted',tone:'success',latest:{name:'Battery',id:'BAT-1'},message:'Added'},reader:{state:'ready'}});
  assert.match(view.text(),/Added to reviewBattery · BAT-1/);assert.equal(view.nodes().find(node=>node.props.className==='scan-outcome-card').props['data-pulse'],'success');
  view.render({feedback:{sequence:2,outcomeType:'duplicate',expression:'duplicate',message:'Already in this review',tone:''}});assert.match(view.text(),/Already recordedAlready in this review/);assert.equal(view.nodes().find(node=>node.props.className==='scan-outcome-card').props['data-outcome'],'duplicate');assert.equal(view.nodes().filter(node=>node.props.className==='scan-outcome-reserve').length,1);view.unmount();
});

test('a duplicate remains readable through pause, while reader lifecycle stays visible separately',async()=>{
  const feedback={sequence:4,outcomeType:'duplicate',message:'BAT-41 is already in this review queue.',acquisitionId:'duplicate-attempt',eventId:'reader-event',stage:'processing',operation:'review'};
  const view=await outcomeHarness({feedback,reader:{state:'ready',attemptId:'duplicate-attempt'}});
  view.render({reader:{state:'paused',message:'Reading paused · App left the foreground',code:'BACKGROUND',attemptId:null}});
  assert.match(view.text(),/Already recordedBAT-41 is already in this review queue\.Reading paused/);
  assert.equal(view.nodes().find(node=>node.props.className==='scan-outcome-card').props['data-outcome'],'duplicate');
  view.open();const dialog=view.nodes().find(node=>node.props.role==='dialog');
  assert.match(text(dialog),/App left the foreground/);assert.match(text(dialog),/Attempt: duplicate-attempt/);assert.match(text(dialog),/Stage: processing · review/);assert.match(text(dialog),/Event: reader-event/);
  view.close();view.render({feedback:{sequence:4,outcomeType:'',message:'',acquisitionId:null},reader:{state:'starting',message:'Preparing NFC reader'}});
  assert.doesNotMatch(view.text(),/BAT-41|Already recorded/);assert.match(view.text(),/Preparing NFC reader/);view.unmount();
});

test('a rejected acquisition survives tone expiry and pause with its original error provenance',async()=>{
  const feedback={sequence:7,outcomeType:'failure',tone:'failure',message:'This battery is retired and cannot be checked out.',code:'RETIRED',stage:'processing',operation:'eligibility',acquisitionId:'rejected-attempt'};
  const view=await outcomeHarness({feedback,reader:{state:'fault',message:feedback.message,stage:'processing',code:'RETIRED',attemptId:'rejected-attempt'}});
  view.render({feedback:{...feedback,tone:'',expression:''},reader:{state:'paused',message:'Reading paused · Start again when ready',attemptId:null}});
  const card=view.nodes().find(node=>node.props.className==='scan-outcome-card');assert.equal(card.props.role,'alert');assert.equal(card.props['data-outcome'],'failure');assert.equal(card.props['data-stage'],'processing');
  assert.match(view.text(),/Scan not acceptedThis battery is retired and cannot be checked out\.Reading paused/);
  view.open();const dialog=text(view.nodes().find(node=>node.props.role==='dialog'));assert.match(dialog,/Attempt: rejected-attempt/);assert.match(dialog,/Code: RETIRED/);assert.match(dialog,/Stage: processing · eligibility/);view.unmount();
});

test('a current infrastructure fault outranks an earlier duplicate but preserves both distinct explanations',async()=>{
  const view=await outcomeHarness({feedback:{sequence:2,outcomeType:'duplicate',message:'BAT-41 is already queued.',acquisitionId:'old-attempt',stage:'processing'},reader:{state:'fault',failureKind:'infrastructure',stage:'evidence',operation:'queue',code:'QUEUE_PERSISTENCE',attemptId:'save-attempt',message:'Device save failed. Retain the original queue.',recovery:{retry:async()=>{},export:async()=>{}}}});
  assert.match(view.text(),/Review queue not savedDevice save failed/);assert.equal(view.nodes().find(node=>node.props.className==='scan-outcome-card').props['data-outcome'],'fault');
  view.open();const dialog=text(view.nodes().find(node=>node.props.role==='dialog'));assert.match(dialog,/Previous result · Already recorded/);assert.match(dialog,/Attempt: old-attempt/);assert.match(dialog,/Attempt: save-attempt/);assert.match(dialog,/Retry device save/);assert.match(dialog,/Export preserved data/);view.unmount();
});

test('a paused reader cannot display a stale green acquisition success',async()=>{
  const view=await outcomeHarness({feedback:{sequence:2,outcomeType:'accepted',tone:'success',latest:{id:'BAT-1'},message:'Added to review'},reader:{state:'paused',message:'Reading cancelled · Start again when ready'}});
  const card=view.nodes().find(node=>node.props.className==='scan-outcome-card');assert.equal(card.props['data-outcome'],'paused');assert.equal(card.props['data-pulse'],undefined);assert.match(view.text(),/Reading paused/);assert.doesNotMatch(view.text(),/Added to review|BAT-1/);view.unmount();
});
test('complete message opens an owned bounded dialog with frozen reason and original diagnostics',async()=>{
  const full='Original transport reason '.repeat(45),view=await outcomeHarness({feedback:{sequence:1,outcomeType:'failure',message:full,code:'TAG_LOST'},reader:{controlIssues:[{at:'2026-10-13T00:00:00Z',code:'CANCEL_FAILED',message:'Original cancellation issue'}]}});
  view.open();assert.deepEqual(view.transitions,[true]);assert.equal(view.parent.inert,true);const dialog=view.nodes().find(node=>node.props.role==='dialog');assert.ok(dialog);assert.equal(dialog.props['data-phone-dialog-frame'],true);assert.match(text(dialog),/Original cancellation issue/);assert.ok(text(dialog).includes(full));
  view.render({feedback:{sequence:2,outcomeType:'accepted',message:'A later result'}});assert.ok(text(view.nodes().find(node=>node.props.role==='dialog')).includes(full),'a new read cannot rewrite the open original message');view.close();assert.deepEqual(view.transitions,[true,false]);assert.equal(view.parent.inert,false);view.unmount();assert.deepEqual(view.transitions,[true,false]);
});
test('message diagnostics retain natural Tab navigation and wrap only at dialog boundaries',async()=>{
  const view=await outcomeHarness({feedback:{outcomeType:'failure',message:'Tag could not be read',code:'TAG_LOST'}});
  const entry=view.control('Read complete scan message');view.open();
  const diagnostics=view.control('Reader diagnostics'),close=view.control('Close message');
  assert.equal(view.activeElement(),close,'opening the message focuses its close action');
  diagnostics.focus();let focused=view.focusLog.length;
  assert.equal(view.key('Tab').defaultPrevented,false,'forward navigation from diagnostics uses the browser default');assert.equal(view.focusLog.length,focused);
  close.focus();focused=view.focusLog.length;
  assert.equal(view.key('Tab',true).defaultPrevented,false,'reverse navigation from close can reach diagnostics');assert.equal(view.focusLog.length,focused);
  assert.equal(view.key('Tab').defaultPrevented,true);assert.equal(view.activeElement(),diagnostics,'forward navigation wraps from the last control');
  assert.equal(view.key('Tab',true).defaultPrevented,true);assert.equal(view.activeElement(),close,'reverse navigation wraps from the first control');
  assert.equal(view.key('Escape').defaultPrevented,true);assert.equal(view.parent.inert,false);assert.equal(view.activeElement(),entry,'closing restores the original capsule action');assert.deepEqual(view.transitions,[true,false]);
  assert.equal(view.key('Tab').defaultPrevented,false,'the message key listener is removed after closing');view.unmount();
});

test('a message without diagnostics keeps both Tab directions on its only action',async()=>{
  const view=await outcomeHarness({feedback:{message:'Ready for the next tag'}});view.open();
  const close=view.control('Close message');assert.equal(view.activeElement(),close);
  for(const reverse of [false,true]){assert.equal(view.key('Tab',reverse).defaultPrevented,true);assert.equal(view.activeElement(),close);}
  view.close();assert.equal(view.parent.inert,false);assert.deepEqual(view.transitions,[true,false]);view.unmount();
});

test('unmount of an open message never requests an unconditional reader resume',async()=>{
  const view=await outcomeHarness({feedback:{message:'Saved device evidence'}});view.open();view.unmount();assert.deepEqual(view.transitions,[true]);assert.equal(view.parent.inert,false);
});
test('outcome motion runs once per changed event and reduced motion runs no animation',async()=>{
  const view=await outcomeHarness({feedback:{sequence:1}});assert.equal(view.animations.length,0);view.render({feedback:{sequence:2,outcomeType:'accepted'}});assert.equal(view.animations.length,1);view.render({feedback:{sequence:2,tone:''}});assert.equal(view.animations.length,1);view.render({feedback:{sequence:3,outcomeType:'duplicate'}});assert.equal(view.animations[0].cancelled,true);assert.equal(view.animations.length,2);view.unmount();
  const reduced=await outcomeHarness({feedback:{sequence:1}},true);reduced.render({feedback:{sequence:2,outcomeType:'accepted'}});assert.equal(reduced.animations.length,0);reduced.unmount();
});
test('outcome reserve scales with the same text styles instead of a fixed pixel height',async()=>{
  const css=await readFile(new URL('../src/features/scan/outcome-status.css',import.meta.url),'utf8');assert.match(css,/scan-outcome-card,.scan-outcome-reserve\{grid-area:1\/1/);assert.match(css,/font-size:1rem/);assert.match(css,/font-size:\.875rem/);assert.doesNotMatch(css,/height:(?:88|72)px/);assert.match(css,/scan-outcome-dialog \[data-phone-dialog-body\]\{overflow:auto/);
});
test('local input changes fade without moving click targets or resetting input/scroll, and rapid changes interrupt',async()=>{
  const hooks=[],animations=[];let cursor=0,reduced=false;const ref={current:{scrollTop:137,input:'retained text',animate(frames,options){const animation={frames,options,cancelled:false,cancel(){this.cancelled=true;}};animations.push(animation);return animation;}}};
  const source=(await readFile(new URL('../src/features/scan/use-scan-mode-motion.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''),run=new Function('useRef','useEffect','usePhoneReducedMotion',source+'\nreturn useScanModeMotion;')(initial=>hooks[cursor++]??={current:initial},(effect,deps)=>{const i=cursor++,old=hooks[i];if(!old||deps.some((value,index)=>!Object.is(value,old.deps[index]))){old?.cleanup?.();hooks[i]={deps,cleanup:effect()};}},()=>reduced);
  const render=mode=>{cursor=0;run(ref,mode);};render('native');assert.equal(animations.length,0);render('selection');assert.equal(animations.length,1);assert.deepEqual(animations[0].frames,[{opacity:.35},{opacity:1}]);assert.equal(animations[0].options.duration,180);render('native');assert.equal(animations[0].cancelled,true);assert.equal(animations.length,2);assert.equal(ref.current.scrollTop,137);assert.equal(ref.current.input,'retained text');reduced=true;render('selection');assert.equal(animations[1].cancelled,true);assert.equal(animations.length,2);
});
