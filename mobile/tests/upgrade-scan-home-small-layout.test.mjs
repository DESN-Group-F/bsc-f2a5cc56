import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';

const stylesheet = postcss.parse(await readFile(new URL('../src/features/scan/scan.css',import.meta.url),'utf8'));
function style(selector,width,height=568) {
  const result={};
  stylesheet.walkRules(rule=>{
    if(!rule.selectors.includes(selector))return;
    for(let parent=rule.parent;parent;parent=parent.parent)if(parent.type==='atrule'&&parent.name==='media'){
      if(parent.params.includes('prefers-'))return;
      for(const match of parent.params.matchAll(/\((min|max)-(width|height):\s*(\d+)px\)/g)){
        const actual=match[2]==='width'?width:height,bound=Number(match[3]);
        if(match[1]==='min'?actual<bound:actual>bound)return;
      }
    }
    rule.walkDecls(declaration=>{result[declaration.prop]=declaration.value;});
  });
  return result;
}

test('small home retains paired operations while shrinking the decorative orb first',()=>{
  for(const width of [320,360,380,412])for(const scrollbar of [0,17]){
    const home=style('.mobile-scan-home',width,640),grid=style('.scan-action-grid',width,640);
    const padding=home.padding.split(' ').map(Number.parseFloat),inlinePadding=padding[1]*2;
    const gap=Number.parseFloat(grid.gap);
    const available=width-inlinePadding-scrollbar;
    assert.equal(grid['grid-template-columns'],'repeat(2,minmax(0,1fr))');
    assert.ok((available-gap)/2>=125,`${width}px with ${scrollbar}px scrollbar retains two usable targets`);
    assert.equal(home['--scan-home-orb-size'],'128px');
  }
  assert.equal(style('.mobile-scan-home',412,828)['--scan-home-orb-size'],'168px');
});

test('home controls grow with text and leave scrolling to the main phone surface',()=>{
  for(const selector of ['.mobile-scan-home','.scan-home-composition','.scan-lookup-entry','.scan-action-grid','.scan-action-tile','.scan-entry-actions']){
    const rule=style(selector,320,640);
    assert.notEqual(rule.overflow,'hidden');assert.notEqual(rule.overflow,'auto');assert.equal(rule['max-height'],undefined);
  }
  const tile=style('.scan-action-tile',320,640),title=style('.scan-action-tile strong',320,640),cta=style('.scan-entry-actions>button',320,640),hero=style('.scan-lookup-entry',320,640);
  assert.equal(tile.height,undefined);assert.equal(title['overflow-wrap'],'anywhere');
  assert.equal(cta['min-height'],'48px');assert.equal(cta['white-space'],'normal');assert.equal(hero.border,'0');assert.equal(hero.background,'transparent');
  assert.equal(style('.scan-lookup-target',320,640).position,undefined,'The CTA is a normal-flow control, not an invisible card overlay');
  const landscape=style('.scan-home-composition',828,388);
  assert.equal(landscape['grid-template-columns'],'minmax(0,1fr) minmax(0,1.2fr)');
});
