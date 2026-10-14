// Adapted from the approved local navigation study: a finite spring, a thin
// changing chromatic outline and a clipped optical copy of the real labels.
// This controller paints only; it cannot select routes or authorize work.
const clamp=(value,low,high)=>Math.min(high,Math.max(low,value));

export function createIosDockMotion({bar,lens,optics,initial=0,reduced=false,hidden=false,requestFrame=requestAnimationFrame,cancelFrame=cancelAnimationFrame,observeSize=callback=>new ResizeObserver(callback)}) {
  const tabs=[...bar.querySelectorAll(':scope>button')], items=[...optics.children];
  let selected=initial, frame=0, previousTime=0, tracking=false, disposed=false, step=1, height=54, pointerTime=0;
  const state={x:initial,v:0,target:initial,press:0,pv:0,pressTarget:0,stretch:0,sv:0,lean:0,lv:0,outline:0,ov:0};
  function paint() {
    const p=reduced||hidden?0:clamp(state.press,0,1.08), strain=(reduced||hidden?0:state.stretch)*.55;
    const sx=1+.22*p+strain, sy=1+.28*p-strain*.15, tail=state.lean*strain*step*.06, dx=state.x*step-tail;
    lens.style.transform=`translate3d(${dx}px,${-p*1.1}px,0) scale(${sx},${sy})`;
    lens.style.setProperty('--ios-lens-press',String(p));
    const contour=clamp(state.outline,-1.05,1.05), radius=Math.min(height/2+1.5*p,step*.4), horizontal=contour*6,vertical=contour*2.4;
    lens.style.borderRadius=`${radius+horizontal}px ${radius-horizontal}px ${radius-horizontal*.8}px ${radius+horizontal*.8}px / ${height/2-vertical}px ${height/2+vertical}px ${height/2-vertical}px ${height/2+vertical}px`;
    lens.style.setProperty('--ios-edge-width',`${.7/Math.sqrt(sx*sy)}px`);
    lens.style.setProperty('--ios-edge-angle',`${20+state.x*38+contour*24}deg`);
    const zoom=1+.23*p, center=state.x*step+step/2-tail;
    optics.style.transform=`matrix(${zoom/sx},0,0,${zoom/sy},${step/2-center*zoom/sx},${height/2-height/2*zoom/sy})`;
    tabs.forEach((tab,index)=>{const proximity=Math.max(0,1-Math.abs(state.x-index)/.78);tab.style.opacity=String(1-.84*p*proximity);items[index].dataset.active=String(index===Math.round(tracking?state.x:selected));});
  }
  function spring(key,velocity,target,k,c,dt){state[velocity]+=((target-state[key])*k-state[velocity]*c)*dt;state[key]+=state[velocity]*dt;}
  function settle(){state.x=state.target;state.v=0;state.press=state.pressTarget;for(const key of ['pv','stretch','sv','lean','lv','outline','ov'])state[key]=0;paint();}
  function tick(time) {
    frame=0;if(disposed||hidden)return;
    const dt=Math.min(.032,(time-(previousTime||time-16))/1000);previousTime=time;
    const strain=Math.min(.17,Math.abs(state.v)*.012+Math.abs(state.target-state.x)*.034),direction=Math.tanh(state.v*.32),outline=Math.tanh(state.v*.5)*Math.min(1,.3+state.press*.7);
    const count=Math.max(1,Math.ceil(dt/.005));
    for(let index=0;index<count;index++){const h=dt/count;if(!tracking)spring('x','v',state.target,600*1.08**2,(43-.4*12)*1.08,h);spring('press','pv',state.pressTarget,850,48,h);spring('stretch','sv',strain,380,30,h);spring('lean','lv',direction,320,29,h);spring('outline','ov',outline,230,22,h);}
    if(tracking)state.v*=Math.exp(-dt*25);
    paint();
    const moving=Math.abs(state.target-state.x)>.0004||Math.abs(state.v)>.003||Math.abs(state.pressTarget-state.press)>.0005||Math.abs(state.pv)>.005||Math.abs(state.stretch)>.0005||Math.abs(state.sv)>.005||Math.abs(state.lean)>.002||Math.abs(state.lv)>.01||Math.abs(state.outline)>.0005||Math.abs(state.ov)>.005;
    if(moving)frame=requestFrame(tick);else{previousTime=0;settle();}
  }
  function wake(){if(disposed)return;if(reduced||hidden||bar.ownerDocument?.visibilityState==='hidden'){if(frame)cancelFrame(frame);frame=0;previousTime=0;settle();return;}if(!frame){previousTime=0;frame=requestFrame(tick);}}
  function measure(){step=Math.max(1,(bar.clientWidth-10)/3);height=Math.max(1,lens.clientHeight);optics.style.width=`${step*3}px`;optics.style.height=`${height}px`;paint();}
  const observer=observeSize(measure);observer.observe(bar);measure();
  return {
    select(value){selected=clamp(value,0,2);tracking=false;state.target=selected;state.pressTarget=0;wake();},
    press(value){if(!Number.isFinite(value)||hidden)return;tracking=false;state.target=Math.round(clamp(value,0,2));state.pressTarget=1;wake();},
    drag(value,time){if(!Number.isFinite(value)||hidden)return;tracking=true;const next=clamp(value,0,2),dt=Math.max(8,Math.min(85,time-pointerTime));state.v=clamp((next-state.x)*1000/dt,-12,12);state.x=next;state.target=next;state.pressTarget=1;pointerTime=time;paint();wake();},
    cancel(){tracking=false;state.target=selected;state.pressTarget=0;wake();},
    dispose(){disposed=true;if(frame)cancelFrame(frame);frame=0;observer.disconnect();tabs.forEach(tab=>tab.style.removeProperty('opacity'));},
  };
}
