import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const javaDirectory = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin')
  : process.platform === 'win32' ? 'C:/Program Files/Common Files/Oracle/Java/javapath' : '';
const executable = name => javaDirectory ? path.join(javaDirectory, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;

// These intentionally small test doubles expose only the SDK operations used by
// the plugin. They test its real Java control flow, not Android radio behavior or SDK linking.
const sources = {
  'android/os/Looper.java': `package android.os; public class Looper { public static Looper getMainLooper() { return new Looper(); } }`,
  'android/os/Handler.java': `package android.os;
import java.util.*; import java.util.concurrent.*;
public class Handler {
 public static final Queue<Runnable> queue = new ConcurrentLinkedQueue<>();
 public static final List<Runnable> delayed = new CopyOnWriteArrayList<>();
 public Handler(Looper ignored) {} public boolean post(Runnable r) { queue.add(r); return true; }
 public boolean postDelayed(Runnable r, long ms) { delayed.add(r); return true; }
 public void removeCallbacks(Runnable r) { delayed.remove(r); }
 public static void drain() { Runnable r; while ((r = queue.poll()) != null) r.run(); }
 public static void timeout() { var copied = new ArrayList<>(delayed); delayed.clear(); copied.forEach(Runnable::run); drain(); }
}`,
  'androidx/lifecycle/Lifecycle.java': `package androidx.lifecycle; public class Lifecycle {
 public enum State { CREATED, RESUMED; public boolean isAtLeast(State other) { return ordinal() >= other.ordinal(); } }
 public State state = State.RESUMED; public State getCurrentState() { return state; }
}`,
  'com/getcapacitor/TestActivity.java': `package com.getcapacitor; public class TestActivity {
 public final androidx.lifecycle.Lifecycle lifecycle = new androidx.lifecycle.Lifecycle();
 public androidx.lifecycle.Lifecycle getLifecycle() { return lifecycle; }
}`,
  'com/getcapacitor/Plugin.java': `package com.getcapacitor; public class Plugin {
 public final TestActivity activity = new TestActivity(); public Object getContext() { return this; }
 public TestActivity getActivity() { return activity; } public void load() {}
 protected void handleOnPause() {} protected void handleOnDestroy() {}
}`,
  'com/getcapacitor/PluginMethod.java': `package com.getcapacitor; public @interface PluginMethod {}`,
  'com/getcapacitor/annotation/CapacitorPlugin.java': `package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }`,
  'org/json/JSONObject.java': `package org.json; import java.util.*; public class JSONObject {
 public static final Object NULL = new Object(); protected final Map<String,Object> values = new HashMap<>();
 public boolean has(String key) { return values.containsKey(key); } public Object opt(String key) { return values.get(key); }
 public Object get(String key) { return values.get(key); }
 public String optString(String key, String fallback) { Object value = values.get(key); return value == null ? fallback : value.toString(); }
}`,
  'com/getcapacitor/JSObject.java': `package com.getcapacitor; public class JSObject extends org.json.JSONObject {
 public JSObject put(String key, Object value) { values.put(key, value); return this; }
}`,
  'com/getcapacitor/JSArray.java': `package com.getcapacitor; public class JSArray extends java.util.ArrayList<Object> {
 public JSArray put(Object value) { add(value); return this; }
}`,
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor; public class PluginCall {
 public final JSObject data = new JSObject(); public JSObject result; public String error, code; public int settled;
 public JSObject getData() { return data; } public void resolve() { settled++; }
 public void resolve(JSObject value) { result = value; settled++; }
 public void reject(String message, String reason) { error = message; code = reason; settled++; }
}`,
  'android/nfc/NfcAdapter.java': `package android.nfc; public class NfcAdapter {
 public static final int FLAG_READER_NFC_A = 1; public static NfcAdapter instance = new NfcAdapter();
 public boolean enabled = true; public ReaderCallback callback; public int disables, flags;
 public interface ReaderCallback { void onTagDiscovered(Tag tag); }
 public static NfcAdapter getDefaultAdapter(Object context) { return instance; } public boolean isEnabled() { return enabled; }
 public void enableReaderMode(Object activity, ReaderCallback reader, int options, Object extras) { callback = reader; flags = options; }
 public void disableReaderMode(Object activity) { disables++; callback = null; }
}`,
  'android/nfc/Tag.java': `package android.nfc; public class Tag {
 public byte[] id; public boolean nfca = true; public android.nfc.tech.Ndef ndef;
 public Tag(byte[] value, android.nfc.tech.Ndef data) { id = value; ndef = data; }
 public byte[] getId() { return id; }
}`,
  'android/nfc/tech/NfcA.java': `package android.nfc.tech; public class NfcA {
 public static NfcA get(android.nfc.Tag tag) { return tag.nfca ? new NfcA() : null; }
}`,
  'android/nfc/NdefMessage.java': `package android.nfc; public class NdefMessage {
 private final NdefRecord[] records; public NdefMessage(NdefRecord... values) { records = values; }
 public NdefRecord[] getRecords() { return records; }
}`,
  'android/nfc/NdefRecord.java': `package android.nfc; public class NdefRecord {
 public short getTnf() { return 1; } public byte[] getType() { return new byte[]{0,84}; }
 public byte[] getId() { return new byte[]{0,1}; } public byte[] getPayload() { return new byte[]{0,2,(byte)255}; }
}`,
  'android/nfc/tech/Ndef.java': `package android.nfc.tech;
import java.io.*; import java.util.concurrent.*; import java.util.concurrent.atomic.*;
public class Ndef {
 public boolean writable = true, failRead, blockConnect, blockClose; public android.nfc.NdefMessage message;
 public final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), closeEntered = new CountDownLatch(1), allowClose = new CountDownLatch(1);
 public final AtomicInteger closes = new AtomicInteger();
 public static Ndef get(android.nfc.Tag tag) { return tag.ndef; }
 public boolean isWritable() { return writable; } public int getMaxSize() { return 144; }
 public void connect() throws IOException { entered.countDown(); if (blockConnect) await(release); }
 public android.nfc.NdefMessage getNdefMessage() throws IOException { if (failRead) throw new IOException("Tag left field"); return message; }
 public void close() throws IOException { closes.incrementAndGet(); closeEntered.countDown(); if (blockClose) await(allowClose); release.countDown(); }
 private static void await(CountDownLatch latch) throws IOException { try { if (!latch.await(3, TimeUnit.SECONDS)) throw new IOException("Test timeout"); } catch (InterruptedException e) { throw new IOException(e); } }
}`,
  'com/batteryinventory/nfc/LifecycleHarness.java': `package com.batteryinventory.nfc;
import android.nfc.*; import android.nfc.tech.*; import android.os.Handler; import com.getcapacitor.*;
import java.util.concurrent.*; import java.util.function.*;
public class LifecycleHarness {
 static int checks; static class Subject extends BatteryNfcPlugin { void pause() { handleOnPause(); } void destroy() { handleOnDestroy(); } }
 static Subject fresh() { Handler.drain(); check(Handler.delayed.isEmpty(), "no leaked timeout"); NfcAdapter.instance = new NfcAdapter(); Subject p = new Subject(); p.load(); return p; }
 static void check(boolean value, String label) { if (!value) throw new AssertionError(label); checks++; }
 static boolean idle(Subject p) { try { var field = BatteryNfcPlugin.class.getDeclaredField("active"); field.setAccessible(true); return field.get(p) == null; } catch (Exception e) { throw new AssertionError(e); } }
 static PluginCall read(Subject p) { PluginCall c = new PluginCall(); p.read(c); Handler.drain(); return c; }
 static Tag tag(Ndef ndef) { return new Tag(new byte[]{0,4,(byte)0xab}, ndef); }
 static void emit(Ndef ndef) { NfcAdapter.instance.callback.onTagDiscovered(tag(ndef)); Handler.drain(); }
 static void waitFor(BooleanSupplier ready) throws Exception { long end = System.nanoTime() + 3_000_000_000L; while (!ready.getAsBoolean() && System.nanoTime() < end) { Handler.drain(); Thread.sleep(2); } Handler.drain(); check(ready.getAsBoolean(), "asynchronous completion"); }
 static void settled(PluginCall c, String code) { check(c.settled == 1, "exactly one terminal result"); check(code.equals(c.code), "expected rejection " + code); }
 public static void main(String[] args) throws Exception {
  Subject p = fresh(); NfcAdapter.instance.enabled = false; PluginCall availability = new PluginCall(); p.getAvailability(availability); Handler.drain();
  check(Boolean.FALSE.equals(availability.result.get("enabled")), "disabled availability"); settled(read(p), "DISABLED");
  NfcAdapter.instance.enabled = true;
  for (Object invalid : new Object[]{true, 0, 1000.5, 60001, "20000"}) { PluginCall c = new PluginCall(); c.data.put("timeoutMs", invalid); p.read(c); Handler.drain(); settled(c, "INVALID_ARGUMENT"); }
  PluginCall first = read(p); NfcAdapter.ReaderCallback old = NfcAdapter.instance.callback; settled(read(p), "BUSY");
  PluginCall cancel = new PluginCall(); p.cancel(cancel); Handler.drain(); settled(first, "CANCELLED"); check(cancel.settled == 1, "cancel resolves");
  PluginCall next = read(p); int disables = NfcAdapter.instance.disables; old.onTagDiscovered(tag(null)); Handler.drain();
  check(next.settled == 0 && NfcAdapter.instance.disables == disables, "old callback cannot finish or disable new read");
  Ndef blank = new Ndef(); emit(blank); waitFor(() -> next.settled == 1);
  check("0004AB".equals(next.result.get("uidHex")), "UID order and leading zero preserved");
  check(((JSArray)next.result.get("records")).isEmpty(), "initialized blank NDEF is empty");
  check("readWrite".equals(next.result.get("ndefStatus")) && Integer.valueOf(144).equals(next.result.get("capacityBytes")), "observed NDEF metadata");
  check(blank.closes.get() > 0 && Handler.delayed.isEmpty(), "I/O and timer cleaned");
  check(NfcAdapter.instance.flags == NfcAdapter.FLAG_READER_NFC_A, "NDEF discovery not skipped");
  PluginCall unsupported = read(p); emit(null); check("notSupported".equals(unsupported.result.get("ndefStatus")), "no NDEF interface");
  check(unsupported.result.get("capacityBytes") == org.json.JSONObject.NULL, "unknown capacity stays null");
  PluginCall records = read(p); Ndef data = new Ndef(); data.writable = false; data.message = new NdefMessage(new NdefRecord()); emit(data); waitFor(() -> records.settled == 1);
  JSObject record = (JSObject)((JSArray)records.result.get("records")).get(0);
  check("0054".equals(record.get("typeHex")) && "0001".equals(record.get("idHex")) && "0002FF".equals(record.get("payloadHex")), "raw record bytes preserved");
  check("readOnly".equals(records.result.get("ndefStatus")), "read-only tag status");
  PluginCall lost = read(p); Ndef lostTag = new Ndef(); lostTag.failRead = true; emit(lostTag); waitFor(() -> lost.settled == 1);
  check("0004AB".equals(lost.result.get("uidHex")) && lost.result.optString("ndefError", "").contains("Tag left field"), "NDEF failure retains observed UID");
  PluginCall noTag = read(p); Handler.timeout(); settled(noTag, "TIMEOUT");
  PluginCall paused = read(p); p.pause(); Handler.drain(); settled(paused, "BACKGROUND");
  PluginCall timed = read(p); Ndef slow = new Ndef(); slow.blockConnect = true; emit(slow); check(slow.entered.await(1, TimeUnit.SECONDS), "I/O started"); Handler.timeout();
  check(timed.settled == 1 && timed.result.optString("ndefError", "").startsWith("TIMEOUT"), "timeout retains observed UID");
  waitFor(() -> slow.closes.get() >= 2 && idle(p)); check(timed.settled == 1, "late I/O does not settle twice");
  PluginCall blocked = read(p); Ndef closing = new Ndef(); closing.blockConnect = true; closing.blockClose = true; emit(closing); check(closing.entered.await(1, TimeUnit.SECONDS), "blocked I/O started");
  p.cancel(new PluginCall()); Handler.drain(); settled(blocked, "CANCELLED"); check(closing.closeEntered.await(1, TimeUnit.SECONDS), "cancellation closes from another thread");
  settled(read(p), "BUSY"); closing.allowClose.countDown(); waitFor(() -> closing.closes.get() >= 2 && idle(p));
  PluginCall afterClose = read(p); check(afterClose.settled == 0, "can read after cleanup finishes"); emit(null); check(afterClose.settled == 1, "replacement read succeeds");
  PluginCall destroyed = read(p); p.destroy(); Handler.drain(); settled(destroyed, "CANCELLED"); settled(read(p), "UNAVAILABLE");
  check(Handler.delayed.isEmpty(), "destroy leaves no timeout");
  System.out.println("Passed " + checks + " controlled lifecycle assertions against the actual Android plugin. No Android SDK or hardware acceptance is implied.");
 }
}`,
};

test('actual Android Java lifecycle under controlled SDK doubles', { timeout: 30_000 }, async context => {
  if (javaDirectory && !existsSync(executable('javac'))) return context.skip('JDK unavailable; no native lifecycle check executed.');
  const version = spawnSync(executable('javac'), ['-version'], { encoding: 'utf8', windowsHide: true });
  if (version.error) return context.skip('JDK unavailable; no native lifecycle check executed.');
  const work = path.join(pluginRoot, 'work');
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(path.join(work, 'android-lifecycle-'));
  const files = [];
  for (const [relative, source] of Object.entries(sources)) {
    const file = path.join(directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
    files.push(file);
  }
  const target = path.join(pluginRoot, 'android/src/main/java/com/batteryinventory/nfc/BatteryNfcPlugin.java');
  const compilation = spawnSync(executable('javac'), ['-d', directory, ...files, target], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.error?.message);
  const execution = spawnSync(executable('java'), ['-cp', directory, 'com.batteryinventory.nfc.LifecycleHarness'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
  assert.match(execution.stdout, /Passed \d+ controlled lifecycle assertions/);
  context.diagnostic(execution.stdout.trim());
});
