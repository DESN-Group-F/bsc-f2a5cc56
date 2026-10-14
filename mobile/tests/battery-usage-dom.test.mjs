import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let runtime;
try { runtime = createRequire(import.meta.url)(process.env.MOBILE_BROWSER_TEST_MODULE || 'playwright'); } catch {}
const options = { skip:!runtime && 'Set MOBILE_BROWSER_TEST_MODULE for actual usage layout and refresh checks.' };
const root = fileURLToPath(new URL('../',import.meta.url));
const fixture = `
import React from 'react';import{createRoot}from'react-dom/client';
import{BatteryPage}from'./src/app/battery-page.jsx';import{PhoneUIProvider}from'./src/app/phone-ui.jsx';
import{activateIosPresentation}from'./src/app/ios-runtime-presentation.mjs';activateIosPresentation(document,true);
const battery={id:'BAT-00000125',name:'Battery from the end of the inventory',loanId:'LOAN-FIXTURE-125',borrowerName:'Fixture holder',ownerName:'Fixture owner',lifecycleStatus:'active',registeredAt:'2025-01-01T00:00:00Z',manufacturedOn:null,firstUsedOn:'2025-01-01'};
const f=window.fixture={requests:[],detail:{battery,events:[],usageSummary:{asOf:'2026-10-14T00:00:00Z',totalCheckouts:1201,completedCheckouts:1200,activeCheckouts:1,totalCheckedOutSeconds:1000000,invalidDurationCount:0}}};
window.fetch=()=>new Promise(resolve=>f.requests.push(()=>resolve(new Response(JSON.stringify(f.detail)))));
createRoot(document.getElementById('root')).render(<PhoneUIProvider namespace='fixture:usage' reducedMotion><div className='phone-app ios-shell'><BatteryPage battery={battery} data={{dataset:'demo'}} iosPresentation revision={1} onOperation={()=>{}}/></div></PhoneUIProvider>);
`;

test('Usage is accessible from the record and retains readable totals during a deliberate refresh', options, async t => {
  const compiled = await build({ stdin:{ contents:fixture,resolveDir:root,sourcefile:'usage-fixture.jsx',loader:'jsx' },bundle:true,write:false,jsx:'automatic',format:'esm',platform:'browser',plugins:[{name:'inline-css',setup(api){api.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));}}] });
  const styles = await Promise.all(['shared/vendor/shadcn-tailwind-4.13.0.css','shared/styles/theme.css','shared/styles/base.css','shared/styles/components.css','app.css','app/phone.css','app/ios-theme.css','app/ios-business.css','app/battery-page.css'].map(file=>readFile(new URL('../src/'+file,import.meta.url),'utf8')));
  const browser = await runtime.chromium.launch({headless:true,...(process.env.MOBILE_BROWSER_TEST_CHANNEL?{channel:process.env.MOBILE_BROWSER_TEST_CHANNEL}:{})});t.after(()=>browser.close());
  for (const viewport of [{width:320,height:640},{width:390,height:844},{width:844,height:390}]) await t.test(`${viewport.width}×${viewport.height}`,async()=>{
    const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',error=>errors.push(error.message));
    try {
      await page.route('https://usage.fixture.test/',route=>route.fulfill({contentType:'text/html',body:'<style>'+styles.join('\n').replace(/@import[^;]+;/g,'')+'html{font-size:16px}body{margin:0}</style><div id="root"></div>'}));
      await page.goto('https://usage.fixture.test/');await page.addScriptTag({content:compiled.outputFiles.find(file=>file.path.endsWith('.js')||file.path==='<stdout>').text,type:'module'});
      const usageTab=page.getByRole('tab',{name:'Usage',exact:true});await usageTab.waitFor();await usageTab.click();
      await page.getByText('Loading borrowing totals…',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Refresh usage',exact:true}).isDisabled(),true);
      await page.evaluate(()=>fixture.requests[0]());await page.getByText('1,201',{exact:true}).waitFor();
      await page.waitForFunction(()=>!document.querySelector('.phone-usage-refresh').disabled);
      if(process.env.MOBILE_USAGE_SCREENSHOT&&viewport.width===390)await page.screenshot({path:process.env.MOBILE_USAGE_SCREENSHOT,fullPage:true});
      for (const enlarged of [false,true]) {
        if(enlarged)await page.evaluate(()=>{for(const node of document.querySelectorAll('.phone-usage :is(dt,dd,p,h2,h3,strong,small),.phone-usage-legend,.phone-usage-refresh,.phone-tabs>button'))node.style.fontSize=(parseFloat(getComputedStyle(node).fontSize)*2)+'px';});
        const geometry=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth,items:[...document.querySelectorAll('.phone-usage :is(dt,dd,p,h2,h3,strong,small),.phone-usage-legend,.phone-tabs>button')].filter(node=>node.getClientRects().length).map(node=>({text:node.textContent,width:node.clientWidth,scroll:node.scrollWidth,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}))}));
        assert.ok(geometry.width<=geometry.viewport+1,`No horizontal page overflow with ${enlarged?'200%':'ordinary'} usage text: ${JSON.stringify(geometry)}`);
        for(const item of geometry.items)assert.ok(item.left>=-1&&item.right<=geometry.viewport+1&&item.scroll<=item.width+1,JSON.stringify(item));
      }
      const refresh=page.getByRole('button',{name:'Refresh usage',exact:true});await refresh.click();await page.getByText('Updating record…',{exact:true}).waitFor();
      assert.equal(await page.getByText('1,201',{exact:true}).count(),1);assert.equal(await refresh.isDisabled(),true);
      await page.evaluate(()=>{fixture.detail.usageSummary.totalCheckouts=1202;fixture.detail.usageSummary.completedCheckouts=1201;fixture.requests[1]();});await page.getByText('1,202',{exact:true}).waitFor();
      assert.equal(await page.locator('.phone-usage-breakdown').getAttribute('aria-label'),'1201 completed checkouts and 1 current checkouts');
      assert.deepEqual(errors,[]);
    } finally {await page.close();}
  });
});
