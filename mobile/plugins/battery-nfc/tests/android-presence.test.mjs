import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { androidSdkFixtures } from './android-sdk-fixtures.mjs';

const pluginRoot=fileURLToPath(new URL('../',import.meta.url));
const javaDirectory=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin'):process.platform==='win32'?'C:/Program Files/Common Files/Oracle/Java/javapath':'';
const executable=name=>javaDirectory?path.join(javaDirectory,`${name}${process.platform==='win32'?'.exe':''}`):name;

test('native presence refinement preserves the exact installed MainActivity startup, Back and NFC bytes',async()=>{
  const activity=await readFile(path.resolve(pluginRoot,'../../android/app/src/main/java/com/batteryinventory/mobile/MainActivity.java'));
  assert.equal(createHash('sha256').update(activity).digest('hex'),'fca6be7edb920c0679b59fd1e98f3174ca1ae53265c392013eb769a85bad912e');
});

// The controlled platform model retains the Android 15 NfcService UID OR NDEF
// debounce predicate, including its different-UID/same-message hazard. It is
// evidence about production plugin decisions, not a real radio or OEM service.
const sources={...androidSdkFixtures,
  'android/nfc/NfcAdapter.java':`package android.nfc;
import java.util.*;import android.os.Handler;
public class NfcAdapter {
 public static final int FLAG_READER_NFC_A=1;public static NfcAdapter instance=new NfcAdapter();
 public boolean enabled=true,applyIgnore=true,throwIgnore;public ReaderCallback callback;public int disables,flags,ignores,lastDebounce;public byte[] ignoredUid;public NdefMessage lastMessage;public OnTagRemovedListener removed;public Tag ignoredTag;public final List<String> events=new java.util.concurrent.CopyOnWriteArrayList<>();
 public interface ReaderCallback {void onTagDiscovered(Tag tag);}public interface OnTagRemovedListener {void onTagRemoved();}
 public static NfcAdapter getDefaultAdapter(Object context){return instance;}public boolean isEnabled(){return enabled;}
 public void enableReaderMode(Object activity,ReaderCallback reader,int options,Object extras){callback=reader;flags=options;events.add("enable");}
 public void disableReaderMode(Object activity){disables++;callback=null;events.add("disable");}
 public boolean ignore(Tag tag,int delay,OnTagRemovedListener listener,Handler handler){
  ignores++;lastDebounce=delay;events.add("ignore:"+delay);if(throwIgnore)throw new IllegalStateException("Controlled ignore failure");if(!applyIgnore)return false;
  if(delay==0){if(ignoredTag==tag){removeHeld();return true;}return false;}
  ignoredUid=tag.getId().clone();ignoredTag=tag;removed=listener;return true;
 }
 public boolean rediscover(Tag tag){
  NdefMessage message=tag.ndef==null?null:tag.ndef.getCachedNdefMessage();
  if(ignoredUid!=null){
   if(Arrays.equals(ignoredUid,tag.getId())||(message!=null&&message.equals(lastMessage))){events.add("drop");return false;}
   removeHeld();
  }
  lastMessage=message;if(callback==null)return false;callback.onTagDiscovered(tag);return true;
 }
 public void removeHeld(){OnTagRemovedListener old=removed;ignoredUid=null;ignoredTag=null;removed=null;if(old!=null)Handler.queue.add(old::onTagRemoved);}
}`,
  'android/nfc/NdefMessage.java':`package android.nfc;public class NdefMessage {
 private final NdefRecord[] records;public NdefMessage(NdefRecord... values){records=values;}public NdefRecord[] getRecords(){return records;}
 @Override public boolean equals(Object other){if(!(other instanceof NdefMessage))return false;NdefRecord[] right=((NdefMessage)other).records;if(records.length!=right.length)return false;for(int i=0;i<records.length;i++)if(!java.util.Arrays.equals(records[i].getPayload(),right[i].getPayload()))return false;return true;}
}`,
  'android/nfc/tech/Ndef.java':androidSdkFixtures['android/nfc/tech/Ndef.java']
    .replace('public boolean writable = true, failRead, blockConnect, blockClose;', 'public boolean writable = true, failRead, blockConnect, blockClose, failClose, cacheOverride;public android.nfc.NdefMessage cachedMessage;')
    .replace('getCachedNdefMessage() { return message; }','getCachedNdefMessage() { return cacheOverride ? cachedMessage : message; }')
    .replace('closes.incrementAndGet(); closeEntered.countDown();','closes.incrementAndGet(); android.nfc.NfcAdapter.instance.events.add("close");if(failClose)throw new IOException("Controlled close failure");closeEntered.countDown();'),
  'com/batteryinventory/nfc/PresenceHarness.java':`package com.batteryinventory.nfc;
import android.nfc.*;import android.nfc.tech.*;import android.os.Handler;import com.getcapacitor.*;import java.util.*;import java.util.function.*;
public class PresenceHarness {
 static int checks;static class Subject extends BatteryNfcPlugin {void pause(){activity.lifecycle.state=androidx.lifecycle.Lifecycle.State.CREATED;handleOnPause();}void resume(){activity.lifecycle.state=androidx.lifecycle.Lifecycle.State.RESUMED;}void destroy(){handleOnDestroy();}}
 static void check(boolean value,String label){checks++;if(!value)throw new AssertionError(label);}
 static Subject fresh(){Handler.drain();check(Handler.delayed.isEmpty(),"Prior test has no active read timer");NfcAdapter.instance=new NfcAdapter();Subject subject=new Subject();subject.load();return subject;}
 static PluginCall read(Subject subject){PluginCall call=new PluginCall();subject.read(call);Handler.drain();return call;}
 static Tag tag(int id,Ndef data){return new Tag(new byte[]{0,4,(byte)id},data);}
 static void waitFor(BooleanSupplier done)throws Exception{long end=System.nanoTime()+3000000000L;while(!done.getAsBoolean()&&System.nanoTime()<end){Handler.drain();Thread.sleep(2);}Handler.drain();check(done.getAsBoolean(),"Asynchronous result completed");}
 static PluginCall complete(Subject subject,Tag tag)throws Exception{PluginCall call=read(subject);check(NfcAdapter.instance.rediscover(tag),"Fresh tag is dispatched");Handler.drain();waitFor(()->call.settled==1);check(call.result!=null&&call.code==null,"Actual read result is retained");return call;}
 static Object field(Subject subject,String name)throws Exception{var field=BatteryNfcPlugin.class.getDeclaredField(name);field.setAccessible(true);return field.get(subject);}
 static void unchangedPayload(PluginCall call,String uid)throws Exception{check(call.settled==1&&uid.equals(call.result.get("uidHex")),"Raw UID and one terminal result remain unchanged");var field=org.json.JSONObject.class.getDeclaredField("values");field.setAccessible(true);Set<?> keys=((Map<?,?>)field.get(call.result)).keySet();check(keys.equals(Set.of("uidHex","technology","ndefStatus","capacityBytes","records","observedAt")),"Presence adds no raw-result fields or fake evidence");}
 public static void main(String[] args)throws Exception{
  Subject subject=fresh();NfcAdapter adapter=NfcAdapter.instance;Tag empty=tag(1,null);PluginCall first=complete(subject,empty);unchangedPayload(first,"000401");check("notSupported".equals(first.result.get("ndefStatus")),"Unsupported NDEF remains truthful");check(adapter.ignores==1&&adapter.lastDebounce==500,"Successful no-interface tag establishes bounded native presence debounce");check(adapter.events.indexOf("ignore:500")<adapter.events.indexOf("disable"),"Debounce is established before disabling the one-shot reader");check(field(subject,"active")==null,"Presence does not hold the read session or block a different UID");
  PluginCall held=read(subject);check(!adapter.rediscover(empty),"Held UID is suppressed after disable/re-enable");Handler.drain();check(held.settled==0&&first.settled==1,"Held discovery creates no new completion or replacement raw read");Handler.timeout();check("TIMEOUT".equals(held.code)&&adapter.ignoredUid!=null,"No-tag TIMEOUT does not clear suppression");PluginCall cancelled=read(subject);check(!adapter.rediscover(empty),"Held UID still suppressed after timeout and rearm");subject.cancel(new PluginCall());Handler.drain();check("CANCELLED".equals(cancelled.code)&&adapter.ignoredUid!=null,"Cancel retains the physical-presence gate");
  adapter.removeHeld();Handler.drain();check(field(subject,"presence")==null,"Physical removal clears only the current presence token");Thread.sleep(5);PluginCall reapplied=complete(subject,empty);check(!first.result.get("observedAt").equals(reapplied.result.get("observedAt")),"Removal and re-presentation produce a fresh observation timestamp");unchangedPayload(reapplied,"000401");
  subject.pause();Handler.drain();check(adapter.ignoredUid==null&&adapter.lastDebounce==0&&field(subject,"presence")==null,"Background releases owned native debounce and local presence");subject.resume();PluginCall resumed=complete(subject,empty);unchangedPayload(resumed,"000401");subject.destroy();Handler.drain();check(adapter.ignoredUid==null&&adapter.lastDebounce==0,"Destroy releases native debounce");check("UNAVAILABLE".equals(read(subject).code),"Destroy cannot reopen reader");

  subject=fresh();adapter=NfcAdapter.instance;Ndef blank=new Ndef();PluginCall blankRead=complete(subject,tag(2,blank));unchangedPayload(blankRead,"000402");check("readWrite".equals(blankRead.result.get("ndefStatus"))&&((JSArray)blankRead.result.get("records")).isEmpty(),"Blank formatted tag retains status and empty evidence");check(adapter.events.indexOf("close")<adapter.events.indexOf("ignore:500")&&adapter.events.indexOf("ignore:500")<adapter.events.indexOf("disable"),"Formatted no-message tag closes NDEF before ignore before reader disable");subject.destroy();Handler.drain();

  subject=fresh();adapter=NfcAdapter.instance;NdefMessage same=new NdefMessage(new NdefRecord());Ndef a=new Ndef();a.message=same;complete(subject,tag(3,a));check(adapter.ignores==0,"NDEF-bearing A is not ignored");complete(subject,tag(4,null));check(adapter.lastMessage==null,"Accepted empty B resets the platform last NDEF message before ignore");Ndef c=new Ndef();c.message=new NdefMessage(new NdefRecord());PluginCall different=complete(subject,tag(5,c));check(((JSArray)different.result.get("records")).size()==1&&adapter.ignores==1,"Different UID C with A's identical nonempty NDEF is not hidden after empty B");Ndef d=new Ndef();d.message=new NdefMessage(new NdefRecord());complete(subject,tag(6,d));check(adapter.ignores==1,"Two different NDEF-bearing UIDs with identical content are both read without broad ignore");
  adapter.ignore(tag(6,d),500,()->{},new Handler(new android.os.Looper()));check(!adapter.rediscover(tag(7,c)),"The model actively exercises Android's UID OR same-NDEF hazard, not UID-only behavior");adapter.removeHeld();Handler.drain();

  subject=fresh();adapter=NfcAdapter.instance;Ndef mismatch=new Ndef();mismatch.cacheOverride=true;mismatch.cachedMessage=same;complete(subject,tag(8,mismatch));check(adapter.ignores==0,"Cached nonempty NDEF with a fresh null read is never ignored");Ndef loss=new Ndef();loss.failRead=true;PluginCall observedLoss=complete(subject,tag(9,loss));check(observedLoss.result.optString("ndefError","").contains("Tag left field")&&adapter.ignores==0,"Read errors retain observed evidence and do not suppress presence");Ndef closeFailure=new Ndef();closeFailure.failClose=true;PluginCall closeRead=complete(subject,tag(10,closeFailure));unchangedPayload(closeRead,"00040A");check(adapter.ignores==0,"Close failure is not mistaken for a successful no-message path");
  adapter.applyIgnore=false;PluginCall refused=complete(subject,tag(11,null));unchangedPayload(refused,"00040B");check(field(subject,"presence")==null,"False ignore does not leave a false local held state");adapter.applyIgnore=true;adapter.throwIgnore=true;PluginCall thrown=complete(subject,tag(12,null));unchangedPayload(thrown,"00040C");check(field(subject,"presence")==null,"Throwing ignore never loses an actual read or fabricates suppression");adapter.throwIgnore=false;

  subject=fresh();adapter=NfcAdapter.instance;complete(subject,tag(13,null));NfcAdapter.OnTagRemovedListener oldRemoved=adapter.removed;complete(subject,tag(14,null));Object newPresence=field(subject,"presence");PluginCall waiting=read(subject);int disables=adapter.disables;oldRemoved.onTagRemoved();check(field(subject,"presence")==newPresence&&waiting.settled==0&&adapter.disables==disables,"Late removed callback cannot clear a newer token, settle its read or disable reader");adapter.removeHeld();Handler.drain();check(field(subject,"presence")==null&&waiting.settled==0&&adapter.disables==disables,"Current removed callback releases only presence, not its successor read");subject.cancel(new PluginCall());Handler.drain();

  subject=fresh();adapter=NfcAdapter.instance;complete(subject,tag(15,null));PluginCall background=read(subject);subject.pause();Handler.drain();check("BACKGROUND".equals(background.code)&&adapter.ignoredUid==null,"Background clears suppression while preserving pending-read cancellation semantics");subject.resume();complete(subject,tag(16,null));PluginCall destroying=read(subject);subject.destroy();Handler.drain();check("CANCELLED".equals(destroying.code)&&adapter.ignoredUid==null&&Handler.delayed.isEmpty(),"Destroy releases debounce and all pending read timers");
  System.out.println("Passed "+checks+" production-Java presence assertions with controlled Android UID-or-NDEF dispatch; no radio or OEM acceptance is implied.");
 }
}`,
};

test('actual Java no-NDEF presence handles held/re-presented tags without broad NDEF suppression or lifecycle loss',{timeout:30000},async context=>{
  if(javaDirectory&&!existsSync(executable('javac')))return context.skip('JDK unavailable; presence compilation was not executed.');
  const version=spawnSync(executable('javac'),['-version'],{encoding:'utf8',windowsHide:true});if(version.error)return context.skip('JDK unavailable; presence compilation was not executed.');
  const base=path.resolve(pluginRoot,'../../../work/mobile-interaction-refinement-20261013');await mkdir(base,{recursive:true});const work=await mkdtemp(path.join(base,'native-presence-java-')),files=[];
  for(const[relative,source]of Object.entries(sources)){const file=path.join(work,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,source);files.push(file);}
  files.push(path.join(pluginRoot,'android/src/main/java/com/batteryinventory/nfc/BatteryNfcPlugin.java'));
  const compiled=spawnSync(executable('javac'),['-d',work,...files],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(compiled.status,0,compiled.stderr||compiled.error?.message);
  const run=spawnSync(executable('java'),['-cp',work,'com.batteryinventory.nfc.PresenceHarness'],{encoding:'utf8',windowsHide:true,timeout:10000});assert.equal(run.status,0,run.stderr||run.error?.message);assert.match(run.stdout,/Passed \d+ production-Java presence assertions/);context.diagnostic(run.stdout.trim());
});
