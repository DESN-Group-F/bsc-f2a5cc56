import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const mobileRoot = fileURLToPath(new URL('../', import.meta.url));
const javaDirectory = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin')
  : process.platform === 'win32' ? 'C:/Program Files/Common Files/Oracle/Java/javapath' : '';
const executable = name => javaDirectory ? path.join(javaDirectory, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;

// Compile the actual Activity and NFC plugin. These doubles model calls and ownership,
// not AOSP routing, Android SDK linkage, radio discovery or physical-device acceptance.
const sources = {
  'test/Trace.java': `package test;
import java.util.*;
public class Trace {
 public static final List<String> events = new ArrayList<>();
 public static final List<Throwable> warnings = new ArrayList<>();
 public static void reset() { events.clear(); warnings.clear(); }
}`,
  'android/os/Bundle.java': 'package android.os; public class Bundle {}',
  'android/os/Build.java': `package android.os; public class Build {
 public static class VERSION { public static int SDK_INT = 36; }
 public static class VERSION_CODES { public static final int S = 31; }
}`,
  'android/os/Looper.java': 'package android.os; public class Looper { public static Looper getMainLooper() { return new Looper(); } }',
  'android/os/Handler.java': `package android.os;
import java.util.*; import java.util.concurrent.*;
public class Handler {
 public static final Queue<Runnable> queue = new ConcurrentLinkedQueue<>();
 public static final List<Runnable> delayed = new CopyOnWriteArrayList<>();
 public Handler(Looper ignored) {}
 public boolean post(Runnable work) { queue.add(work); return true; }
 public boolean postDelayed(Runnable work, long delay) { delayed.add(work); return true; }
 public void removeCallbacks(Runnable work) { delayed.remove(work); }
 public static void drain() { Runnable work; while ((work = queue.poll()) != null) work.run(); }
 public static void timeout() { var ready = new ArrayList<>(delayed); delayed.clear(); ready.forEach(Runnable::run); drain(); }
}`,
  'androidx/lifecycle/Lifecycle.java': `package androidx.lifecycle; public class Lifecycle {
 public enum State { CREATED, RESUMED; public boolean isAtLeast(State other) { return ordinal() >= other.ordinal(); } }
 public State state = State.CREATED;
 public State getCurrentState() { return state; }
}`,
  'android/content/ComponentName.java': `package android.content; public class ComponentName {
 public final Class<?> target;
 public ComponentName(Class<?> value) { target = value; }
 public String getClassName() { return target.getName(); }
}`,
  'android/content/IntentFilter.java': 'package android.content; public class IntentFilter {}',
  'android/net/Uri.java': `package android.net; public class Uri {
 public final String value;
 private Uri(String input) { value = input; }
 public static Uri parse(String input) { return new Uri(input); }
}`,
  'android/content/Intent.java': `package android.content;
import android.net.Uri;
public class Intent {
 public static final int FLAG_ACTIVITY_SINGLE_TOP = 0x20000000;
 public static final int FLAG_ACTIVITY_NEW_TASK = 0x10000000;
 public String action; public int flags, payloadAccesses; public ComponentName component; public Uri data;
 public Intent() {}
 public Intent(String value) { action = value; }
 public Intent(Object context, Class<?> target) { component = new ComponentName(target); }
 public String getAction() { return action; }
 public Intent setAction(String value) { action = value; return this; }
 public Intent addFlags(int value) { flags |= value; return this; }
 public Intent setFlags(int value) { flags = value; return this; }
 public int getFlags() { return flags; }
 public ComponentName getComponent() { return component; }
 public Intent setData(Uri value) { data = value; return this; }
 public Uri getData() { payloadAccesses++; return data; }
 public Object getExtras() { payloadAccesses++; return null; }
 public Object getParcelableExtra(String key) { payloadAccesses++; return null; }
}`,
  'android/app/PendingIntent.java': `package android.app;
import android.content.Intent;
public class PendingIntent {
 public static final int FLAG_UPDATE_CURRENT = 0x08000000;
 public static final int FLAG_IMMUTABLE = 0x04000000;
 public static final int FLAG_MUTABLE = 0x02000000;
 public static PendingIntent last;
 public final Object context; public final int requestCode, flags; public final Intent intent;
 private PendingIntent(Object owner, int request, Intent target, int options) { context = owner; requestCode = request; intent = target; flags = options; }
 public static PendingIntent getActivity(Object owner, int request, Intent target, int options) {
  if (android.os.Build.VERSION.SDK_INT < 31 && (options & FLAG_MUTABLE) != 0) throw new AssertionError("Mutable flag is unavailable before API 31");
  last = new PendingIntent(owner, request, target, options); return last;
 }
}`,
  'android/view/View.java': 'package android.view; public class View {}',
  'android/view/Window.java': `package android.view; public class Window {
 private final View view = new View(); public View getDecorView() { return view; }
}`,
  'android/app/Activity.java': `package android.app;
import android.content.Intent; import android.os.Bundle; import androidx.lifecycle.Lifecycle;
public class Activity {
 public final Lifecycle lifecycle = new Lifecycle(); public final android.view.Window window = new android.view.Window();
 public int delegatedIntents, setIntentCalls; public Intent lastIntent;
 public void onCreate(Bundle state) { test.Trace.events.add("super.create"); }
 protected void onResume() { lifecycle.state = Lifecycle.State.RESUMED; test.Trace.events.add("super.resume"); }
 protected void onPause() { lifecycle.state = Lifecycle.State.CREATED; test.Trace.events.add("super.pause"); }
 protected void onNewIntent(Intent value) { delegatedIntents++; lastIntent = value; test.Trace.events.add("super.intent"); }
 public Lifecycle getLifecycle() { return lifecycle; }
 public android.view.Window getWindow() { return window; }
 public void setIntent(Intent value) { setIntentCalls++; lastIntent = value; }
 public void deliverIntent(Intent value) { onNewIntent(value); }
}`,
  'androidx/activity/OnBackPressedCallback.java': `package androidx.activity; public abstract class OnBackPressedCallback {
 public OnBackPressedCallback(boolean enabled) {} public abstract void handleOnBackPressed();
}`,
  'androidx/activity/OnBackPressedDispatcher.java': `package androidx.activity; public class OnBackPressedDispatcher {
 public void addCallback(Object owner, OnBackPressedCallback callback) {}
}`,
  'androidx/core/view/WindowInsetsCompat.java': `package androidx.core.view; public class WindowInsetsCompat {
 public static class Type { public static int ime() { return 1; } }
 public boolean isVisible(int type) { return false; }
}`,
  'androidx/core/view/ViewCompat.java': `package androidx.core.view; public class ViewCompat {
 public static WindowInsetsCompat getRootWindowInsets(android.view.View view) { return null; }
}`,
  'androidx/core/view/WindowInsetsControllerCompat.java': `package androidx.core.view; public class WindowInsetsControllerCompat {
 public WindowInsetsControllerCompat(android.view.Window window, android.view.View view) {}
 public void hide(int type) {}
}`,
  'android/util/Log.java': `package android.util; public class Log {
 public static int w(String tag, String message) { return 0; }
 public static int w(String tag, String message, Throwable error) { test.Trace.warnings.add(error); return 0; }
}`,
  'com/getcapacitor/Bridge.java': `package com.getcapacitor; public class Bridge {
 public static class Builder { public void addWebViewListener(Object listener) {} }
 public void triggerWindowJSEvent(String event) {}
}`,
  'com/getcapacitor/BridgeActivity.java': `package com.getcapacitor; public class BridgeActivity extends android.app.Activity {
 public Bridge bridge = new Bridge();
 protected final Bridge.Builder bridgeBuilder = new Bridge.Builder();
 public void registerPlugin(Class<?> type) { test.Trace.events.add("register.plugin"); }
 public androidx.activity.OnBackPressedDispatcher getOnBackPressedDispatcher() { return new androidx.activity.OnBackPressedDispatcher(); }
}`,
  'com/batteryinventory/mobile/BatteryUiPlugin.java': 'package com.batteryinventory.mobile; public class BatteryUiPlugin {}',
  'com/batteryinventory/mobile/PhoneStartupBridge.java': 'package com.batteryinventory.mobile; public class PhoneStartupBridge { public static PhoneStartupBridge install(Object activity,Object lifecycle) { return new PhoneStartupBridge(); } }',
  'com/getcapacitor/Plugin.java': `package com.getcapacitor; public class Plugin {
 public android.app.Activity activity = new android.app.Activity();
 public Object getContext() { return activity; } public android.app.Activity getActivity() { return activity; }
 public void load() {} protected void handleOnPause() {} protected void handleOnDestroy() {}
}`,
  'com/getcapacitor/PluginMethod.java': 'package com.getcapacitor; public @interface PluginMethod {}',
  'com/getcapacitor/annotation/CapacitorPlugin.java': 'package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }',
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
 public final JSObject data = new JSObject(); public JSObject result; public String code; public int settled;
 public JSObject getData() { return data; } public void resolve() { settled++; }
 public void resolve(JSObject value) { result = value; settled++; }
 public void reject(String message, String reason) { code = reason; settled++; }
}`,
  'android/nfc/NfcAdapter.java': `package android.nfc;
import android.app.Activity; import android.app.PendingIntent; import android.content.Intent; import android.content.IntentFilter;
public class NfcAdapter {
 public static final int FLAG_READER_NFC_A = 1;
 public static final String ACTION_TAG_DISCOVERED = "android.nfc.action.TAG_DISCOVERED";
 public static final String ACTION_TECH_DISCOVERED = "android.nfc.action.TECH_DISCOVERED";
 public static final String ACTION_NDEF_DISCOVERED = "android.nfc.action.NDEF_DISCOVERED";
 public static NfcAdapter instance = new NfcAdapter();
 public boolean enabled = true, foregroundEnabled, readerEnabled;
 public int foregroundEnables, foregroundDisables, readerEnables, readerDisables, defaultDispatches;
 public RuntimeException enableFailure, disableFailure; public ReaderCallback callback;
 public Activity foregroundActivity; public PendingIntent pendingIntent; public IntentFilter[] filters; public String[][] technologies;
 public interface ReaderCallback { void onTagDiscovered(Tag tag); }
 public interface OnTagRemovedListener { void onTagRemoved(); }
 public boolean ignore(Tag tag,int delay,OnTagRemovedListener listener,android.os.Handler handler) { return false; }
 public static NfcAdapter getDefaultAdapter(Object context) { return instance; }
 public boolean isEnabled() { return enabled; }
 public void enableForegroundDispatch(Activity activity, PendingIntent pending, IntentFilter[] types, String[][] techs) {
  test.Trace.events.add("foreground.enable"); foregroundEnables++;
  if (!activity.getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) throw new AssertionError("Registration must follow super.onResume");
  if (enableFailure != null) throw enableFailure;
  foregroundActivity = activity; pendingIntent = pending; filters = types; technologies = techs; foregroundEnabled = true;
 }
 public void disableForegroundDispatch(Activity activity) {
  test.Trace.events.add("foreground.disable"); foregroundDisables++;
  if (!activity.getLifecycle().getCurrentState().isAtLeast(androidx.lifecycle.Lifecycle.State.RESUMED)) throw new AssertionError("Unregistration must precede super.onPause");
  if (disableFailure != null) throw disableFailure;
  foregroundEnabled = false;
 }
 public void enableReaderMode(Object activity, ReaderCallback reader, int flags, Object options) {
  readerEnables++; callback = reader; readerEnabled = true; test.Trace.events.add("reader.enable");
 }
 public void disableReaderMode(Object activity) { readerDisables++; callback = null; readerEnabled = false; test.Trace.events.add("reader.disable"); }
 // This explicit routing model is only a controlled expectation; it is not an AOSP implementation.
 public void rediscover(Tag tag, Intent intent) {
  if (readerEnabled) callback.onTagDiscovered(tag);
  else if (foregroundEnabled) foregroundActivity.deliverIntent(intent);
  else defaultDispatches++;
 }
}`,
  'android/nfc/Tag.java': `package android.nfc; public class Tag {
 public final byte[] id; public final android.nfc.tech.Ndef ndef;
 public Tag(byte[] uid, android.nfc.tech.Ndef value) { id = uid; ndef = value; }
 public byte[] getId() { return id; }
}`,
  'android/nfc/tech/NfcA.java': `package android.nfc.tech; public class NfcA {
 public static NfcA get(android.nfc.Tag tag) { return new NfcA(); }
}`,
  'android/nfc/NdefMessage.java': `package android.nfc; public class NdefMessage {
 public NdefRecord[] getRecords() { return new NdefRecord[0]; }
}`,
  'android/nfc/NdefRecord.java': `package android.nfc; public class NdefRecord {
 public short getTnf() { return 1; } public byte[] getType() { return new byte[0]; }
 public byte[] getId() { return new byte[0]; } public byte[] getPayload() { return new byte[0]; }
}`,
  'android/nfc/tech/Ndef.java': `package android.nfc.tech;
import java.io.*; import java.util.concurrent.*; import java.util.concurrent.atomic.*;
public class Ndef {
 public boolean blockConnect; public final CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
 public final AtomicInteger closes = new AtomicInteger();
 public static Ndef get(android.nfc.Tag tag) { return tag.ndef; }
 public boolean isWritable() { return true; } public int getMaxSize() { return 144; }
 public void connect() throws IOException { entered.countDown(); if (blockConnect) try { if (!release.await(3, TimeUnit.SECONDS)) throw new IOException("Controlled I/O timeout"); } catch (InterruptedException failure) { throw new IOException(failure); } }
 public android.nfc.NdefMessage getNdefMessage() { return new android.nfc.NdefMessage(); }
 public android.nfc.NdefMessage getCachedNdefMessage() { return new android.nfc.NdefMessage(); }
 public void close() { closes.incrementAndGet(); release.countDown(); }
}`,
  'com/batteryinventory/mobile/DispatchHarness.java': `package com.batteryinventory.mobile;
import android.app.*; import android.content.*; import android.net.Uri; import android.nfc.*; import android.nfc.tech.Ndef; import android.os.*;
import com.getcapacitor.*; import com.batteryinventory.nfc.BatteryNfcPlugin; import java.util.concurrent.*; import java.util.function.*;
public class DispatchHarness {
 static int checks;
 static class Subject extends MainActivity { void resume() { onResume(); } void pause() { onPause(); } void intent(Intent value) { onNewIntent(value); } }
 static class Reader extends BatteryNfcPlugin { void pause() { handleOnPause(); } }
 static void check(boolean value, String label) { if (!value) throw new AssertionError(label); checks++; }
 static Subject fresh(int sdk) {
  Handler.drain(); check(Handler.delayed.isEmpty(), "No leaked reader timeout"); Build.VERSION.SDK_INT = sdk;
  NfcAdapter.instance = new NfcAdapter(); PendingIntent.last = null; test.Trace.reset();
  Subject activity = new Subject(); activity.onCreate(new Bundle()); test.Trace.events.clear(); return activity;
 }
 static Intent nfc(String action) { return new Intent(action).setData(Uri.parse("https://untrusted.example/raw-tag")); }
 static void expectPropagated(Runnable operation, RuntimeException expected) {
  try { operation.run(); throw new AssertionError("Programming error was concealed"); }
  catch (RuntimeException actual) { check(actual == expected, "Programming error remains observable"); }
 }
 static void lifecycleAndPendingIntent() {
  for (int sdk : new int[]{24, 30, 31, 36}) {
   Subject activity = fresh(sdk); NfcAdapter adapter = NfcAdapter.instance; activity.resume();
   check(test.Trace.events.equals(java.util.List.of("super.resume", "foreground.enable")), "Registration follows super.onResume on API " + sdk);
   check(adapter.foregroundEnabled && adapter.foregroundEnables == 1, "Resumed Activity owns dispatch guard");
   PendingIntent pending = adapter.pendingIntent;
   check(pending != null && pending == PendingIntent.last && pending.context == activity, "Activity creates its own getActivity PendingIntent");
   check(pending.intent.getComponent() != null && pending.intent.getComponent().target == MainActivity.class, "PendingIntent explicitly targets MainActivity");
   check(pending.intent.getFlags() == Intent.FLAG_ACTIVITY_SINGLE_TOP, "Explicit target uses only SINGLE_TOP");
   int expected = sdk >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
   check((pending.flags & ~PendingIntent.FLAG_UPDATE_CURRENT) == expected, "Only required mutability and optional UPDATE_CURRENT flags on API " + sdk);
   check((pending.flags & PendingIntent.FLAG_IMMUTABLE) == 0, "NFC PendingIntent accepts system tag extras");
   check(adapter.filters == null && adapter.technologies == null, "Null filters and technologies retain wildcard dispatch");
   activity.pause();
   check(test.Trace.events.equals(java.util.List.of("super.resume", "foreground.enable", "foreground.disable", "super.pause")), "Disable precedes super.onPause");
   check(!adapter.foregroundEnabled && adapter.foregroundDisables == 1, "Paused Activity releases dispatch guard once");
   activity.resume(); check(adapter.foregroundEnabled && adapter.foregroundEnables == 2, "Subsequent resume restores dispatch guard");
   activity.pause(); check(adapter.foregroundDisables == 2, "Each resumed lifecycle has one disable");
  }
 }
 static void intentBoundary() {
  Subject activity = fresh(36); activity.resume();
  for (String action : new String[]{NfcAdapter.ACTION_TAG_DISCOVERED, NfcAdapter.ACTION_TECH_DISCOVERED, NfcAdapter.ACTION_NDEF_DISCOVERED}) {
   Intent value = nfc(action); activity.intent(value);
   check(activity.delegatedIntents == 0 && activity.setIntentCalls == 0, "Raw NFC intent does not reach Capacitor");
   check(value.payloadAccesses == 0, "Raw NFC data and extras remain uninterpreted");
  }
  Intent normal = new Intent("com.batteryinventory.NORMAL"); activity.intent(normal);
  check(activity.delegatedIntents == 1 && activity.lastIntent == normal, "Non-NFC intent follows ordinary super path");
  activity.intent(null); check(activity.delegatedIntents == 2 && activity.lastIntent == null, "Null intent follows ordinary super path");
  activity.pause(); Intent late = nfc(NfcAdapter.ACTION_NDEF_DISCOVERED); activity.intent(late);
  check(activity.delegatedIntents == 2 && activity.setIntentCalls == 0 && late.payloadAccesses == 0, "Delayed NFC intent remains consumed after pause");
 }
 static void absentAndDisabledAdapter() {
  Subject missing = fresh(24); NfcAdapter.instance = null; missing.resume(); missing.intent(new Intent("normal")); missing.pause();
  check(missing.delegatedIntents == 1, "Missing NFC hardware preserves normal intent handling");
  check(test.Trace.events.equals(java.util.List.of("super.resume", "super.intent", "super.pause")), "Missing adapter preserves Activity lifecycle");
  Subject disabled = fresh(36); NfcAdapter.instance.enabled = false; disabled.resume(); disabled.intent(new Intent("normal")); disabled.pause();
  check(disabled.delegatedIntents == 1 && disabled.getLifecycle().getCurrentState() == androidx.lifecycle.Lifecycle.State.CREATED, "Disabled adapter does not interrupt Activity or ordinary intents");
 }
 static RuntimeException[] platformFailures() { return new RuntimeException[]{new UnsupportedOperationException("No NFC service"), new IllegalStateException("Activity transition"), new SecurityException("NFC access denied")}; }
 static void expectedPlatformFailures() {
  for (RuntimeException failure : platformFailures()) {
   Subject activity = fresh(36); NfcAdapter adapter = NfcAdapter.instance; adapter.enableFailure = failure;
   activity.resume(); check(test.Trace.warnings.size() == 1 && test.Trace.warnings.get(0) == failure, "Enable failure is logged with original Throwable");
   activity.intent(new Intent("normal")); check(activity.delegatedIntents == 1, "Enable failure preserves ordinary intent handling");
   activity.pause(); check(adapter.foregroundDisables == 1, "Failed registration still attempts cleanup before pause");
   check(test.Trace.events.indexOf("foreground.disable") < test.Trace.events.indexOf("super.pause"), "Failure cleanup precedes super.onPause");
   adapter.enableFailure = null; activity.resume(); check(adapter.foregroundEnabled && adapter.foregroundEnables == 2, "Next resume retries failed guard registration");
   activity.pause();
  }
  for (RuntimeException failure : platformFailures()) {
   Subject activity = fresh(36); NfcAdapter adapter = NfcAdapter.instance; activity.resume(); adapter.disableFailure = failure; activity.pause();
   check(test.Trace.warnings.size() == 1 && test.Trace.warnings.get(0) == failure, "Disable failure is logged with original Throwable");
   check(activity.getLifecycle().getCurrentState() == androidx.lifecycle.Lifecycle.State.CREATED, "Expected cleanup failure still executes super.onPause");
   adapter.disableFailure = null; activity.resume(); check(adapter.foregroundEnables == 2, "Resume remains usable after cleanup failure"); activity.pause();
  }
  Subject activity = fresh(36); NfcAdapter adapter = NfcAdapter.instance; RuntimeException programming = new IllegalArgumentException("Invalid target"); adapter.enableFailure = programming;
  expectPropagated(activity::resume, programming); check(test.Trace.warnings.isEmpty(), "Programming error is not relabelled as platform failure");
  adapter.enableFailure = null; activity.pause();
 }
 static Tag tag(Ndef connection) { return new Tag(new byte[]{0, 4, (byte)0xab, 0}, connection); }
 static PluginCall read(Reader reader) { PluginCall call = new PluginCall(); reader.read(call); Handler.drain(); return call; }
 static boolean idle(Reader reader) { try { var field = BatteryNfcPlugin.class.getDeclaredField("active"); field.setAccessible(true); return field.get(reader) == null; } catch (Exception failure) { throw new AssertionError(failure); } }
 static void waitFor(BooleanSupplier condition) throws Exception { long end = System.nanoTime() + 3_000_000_000L; while (!condition.getAsBoolean() && System.nanoTime() < end) { Handler.drain(); Thread.sleep(2); } Handler.drain(); check(condition.getAsBoolean(), "Reader cleanup finishes"); }
 static void guardedGap(Subject activity, NfcAdapter adapter, String label) {
  check(!adapter.readerEnabled && adapter.foregroundEnabled, label + ": dispatch guard remains when one-shot reader is off");
  int delegated = activity.delegatedIntents; Intent raw = nfc(NfcAdapter.ACTION_NDEF_DISCOVERED); adapter.rediscover(tag(null), raw); Handler.drain();
  check(adapter.defaultDispatches == 0 && activity.delegatedIntents == delegated && raw.payloadAccesses == 0, label + ": controlled rediscovery is consumed without interpretation");
 }
 static void readerTransitions() throws Exception {
  Subject activity = fresh(36); activity.resume(); NfcAdapter adapter = NfcAdapter.instance;
  Reader reader = new Reader(); reader.activity = activity; reader.load();
  PluginCall first = read(reader); NfcAdapter.ReaderCallback old = adapter.callback;
  check(adapter.foregroundEnabled && adapter.readerEnabled && first.settled == 0, "Reader start retains resumed Activity guard");
  adapter.rediscover(tag(null), nfc(NfcAdapter.ACTION_NDEF_DISCOVERED)); Handler.drain();
  check(first.settled == 1 && "0004AB00".equals(first.result.get("uidHex")), "Actual one-shot plugin returns UID once");
  guardedGap(activity, adapter, "Successful finish and delayed re-arm");
  check(adapter.foregroundEnables == 1 && adapter.foregroundDisables == 0 && adapter.readerDisables == 1, "One-shot completion closes reader mode without releasing dispatch guard");
  PluginCall timeout = read(reader); check(adapter.foregroundEnabled && adapter.readerEnabled, "Re-arm retains guard");
  old.onTagDiscovered(tag(null)); Handler.drain(); check(timeout.settled == 0 && adapter.readerEnabled && adapter.foregroundEnabled, "Old callback cannot finish or disable re-armed reader or dispatch guard");
  Handler.timeout(); check(timeout.settled == 1 && "TIMEOUT".equals(timeout.code), "Actual no-tag timeout settles once");
  guardedGap(activity, adapter, "Timeout and delayed re-arm");
  PluginCall observed = read(reader); Ndef connection = new Ndef(); connection.blockConnect = true;
  adapter.rediscover(tag(connection), nfc(NfcAdapter.ACTION_NDEF_DISCOVERED)); Handler.drain();
  check(connection.entered.await(1, TimeUnit.SECONDS), "Actual reader starts blocked NDEF I/O"); Handler.timeout();
  check(observed.settled == 1 && observed.result.optString("ndefError", "").startsWith("TIMEOUT"), "I/O timeout retains observed UID");
  guardedGap(activity, adapter, "I/O timeout cleanup"); waitFor(() -> idle(reader));
  check(observed.settled == 1 && adapter.foregroundDisables == 0, "Late I/O cleanup does not settle twice or release Activity guard");
  PluginCall cancelled = read(reader); reader.cancel(new PluginCall()); Handler.drain();
  check(cancelled.settled == 1 && "CANCELLED".equals(cancelled.code), "Actual reader cancellation settles once");
  guardedGap(activity, adapter, "Cancellation");
  PluginCall resumed = read(reader); check(adapter.readerEnabled && adapter.foregroundEnabled && resumed.settled == 0, "Replacement read preserves Activity guard");
  activity.pause(); reader.pause(); Handler.drain();
  check(resumed.settled == 1 && "BACKGROUND".equals(resumed.code), "Backgrounding interrupts actual read");
  check(!adapter.foregroundEnabled && !adapter.readerEnabled && adapter.foregroundDisables == 1, "Background releases both independent protections");
  check(Handler.delayed.isEmpty(), "Reader transitions leave no timeout");
 }
 public static void main(String[] arguments) throws Exception {
  lifecycleAndPendingIntent(); intentBoundary(); absentAndDisabledAdapter(); expectedPlatformFailures(); readerTransitions();
  System.out.println("Passed " + checks + " actual-Java Activity dispatch guard assertions against controlled SDK doubles. No AOSP, SDK linking, radio or hardware acceptance is implied.");
 }
}`,
};

test('actual Android Activity consumes raw NFC intents and keeps its dispatch guard across one-shot reader transitions', { timeout: 30_000 }, async context => {
  if (javaDirectory && !existsSync(executable('javac'))) return context.skip('JDK unavailable; no native dispatch guard check executed.');
  const version = spawnSync(executable('javac'), ['-version'], { encoding: 'utf8', windowsHide: true });
  if (version.error) return context.skip('JDK unavailable; no native dispatch guard check executed.');
  const work = path.resolve(mobileRoot, '..', 'work');
  await mkdir(work, { recursive: true });
  const directory = await mkdtemp(path.join(work, 'mobile-android-nfc-dispatch-'));
  const files = [];
  for (const [relative, source] of Object.entries(sources)) {
    const file = path.join(directory, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
    files.push(file);
  }
  files.push(path.join(mobileRoot, 'android/app/src/main/java/com/batteryinventory/mobile/MainActivity.java'));
  files.push(path.join(mobileRoot, 'plugins/battery-nfc/android/src/main/java/com/batteryinventory/nfc/BatteryNfcPlugin.java'));
  const compilation = spawnSync(executable('javac'), ['-d', directory, ...files], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  assert.equal(compilation.status, 0, compilation.stderr || compilation.error?.message);
  const execution = spawnSync(executable('java'), ['-cp', directory, 'com.batteryinventory.mobile.DispatchHarness'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
  assert.equal(execution.status, 0, execution.stderr || execution.error?.message);
  assert.match(execution.stdout, /Passed \d+ actual-Java Activity dispatch guard assertions/);
  context.diagnostic(execution.stdout.trim());
});
