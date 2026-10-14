import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPhoneScrollIntent, phoneScrollOwner } from '../src/app/phone-scroll.mjs';

test('programmatic scrolling and restoration do not suppress deliberate taps', () => {
  let time = 100; const intent = createPhoneScrollIntent(() => time), owner = {};
  intent.scroll(owner); assert.equal(intent.scrolling(owner),false);
  intent.wheel(owner); intent.scroll(owner); assert.equal(intent.scrolling(owner),true);
  intent.settle(owner); time += 5; intent.scroll(owner); assert.equal(intent.scrolling(owner),false);
});
test('touch momentum arrest cancels one activation and permits the next immediate tap', () => {
  let time = 100; const intent = createPhoneScrollIntent(() => time), owner = {};
  intent.begin(owner,0,0); intent.move(0,30); intent.scroll(owner); intent.end();
  time += 16; intent.scroll(owner); assert.equal(intent.scrolling(owner),true);
  intent.begin(owner,0,0); assert.equal(intent.scrolling(owner),true); intent.end();
  assert.equal(intent.scrolling(owner),false); intent.begin(owner,0,0); intent.end();
  assert.equal(intent.scrolling(owner),false);
});
test('a settled or expired user scroll cannot revive from a later programmatic scroll', () => {
  let time = 100; const intent = createPhoneScrollIntent(() => time), owner = {};
  intent.wheel(owner); intent.scroll(owner); time += 111; intent.scroll(owner);
  assert.equal(intent.scrolling(owner),false);
  intent.wheel(owner); intent.scroll(owner); intent.settle(owner); intent.scroll(owner);
  assert.equal(intent.scrolling(owner),false);
});
test('the nearest actual scroll owner is used, including a sheet without a data marker', () => {
  const owner = { nodeType:1,scrollHeight:600,clientHeight:300,parentElement:null,overflowY:'auto' };
  const child = { nodeType:1,scrollHeight:40,clientHeight:40,parentElement:owner,overflowY:'visible' };
  assert.equal(phoneScrollOwner(child,node => node),owner);
});
