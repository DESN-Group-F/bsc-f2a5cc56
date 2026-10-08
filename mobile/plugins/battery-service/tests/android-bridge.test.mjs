import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const javaHome = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin')
  : process.platform === 'win32' ? 'C:/Program Files/Common Files/Oracle/Java/javapath' : '';
const executable = name => javaHome ? path.join(javaHome, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;

// Production plugin and policy execute against controlled platform/storage/HTTP
// doubles. This verifies transport orchestration, not Android SDK or Keystore.
const sources = {
  'org/json/JSONObject.java': `package org.json; import java.util.*; public class JSONObject {
   public static final Object NULL = new Object(); protected final Map<String,Object> values = new HashMap<>();
   public JSONObject() {} public JSONObject(String body) { if (body.contains("signout")) values.put("action", "signout"); }
   public Object opt(String key) { return values.get(key); } public boolean has(String key) { return values.containsKey(key); }
   public Iterator<String> keys() { return values.keySet().iterator(); } public Object get(String key) { return values.get(key); }
   public String optString(String key, String fallback) { Object value = values.get(key); return value instanceof String ? (String)value : fallback; }
   public JSONObject put(String key, Object value) { values.put(key,value); return this; }
  }`,
  'com/getcapacitor/JSObject.java': `package com.getcapacitor; public class JSObject extends org.json.JSONObject { @Override public JSObject put(String key,Object value) { super.put(key,value); return this; } }`,
  'com/getcapacitor/PluginCall.java': `package com.getcapacitor; public class PluginCall {
   public final JSObject data = new JSObject(); public volatile int settled; public volatile JSObject result; public volatile String code,error;
   public JSObject getData() { return data; } public String getString(String key) { Object value = data.opt(key); return value instanceof String ? (String)value : null; }
   public void resolve() { settled++; } public void resolve(JSObject value) { result=value; settled++; }
   public void reject(String message,String reason) { error=message; code=reason; settled++; }
  }`,
  'com/getcapacitor/Plugin.java': `package com.getcapacitor; public class Plugin { private final android.content.Context context=new android.content.Context(); public android.content.Context getContext() { return context; } public void load() {} protected void handleOnDestroy() {} }`,
  'com/getcapacitor/PluginMethod.java': `package com.getcapacitor; public @interface PluginMethod {}`,
  'com/getcapacitor/annotation/CapacitorPlugin.java': `package com.getcapacitor.annotation; public @interface CapacitorPlugin { String name(); }`,
  'android/content/Context.java': `package android.content; import java.util.*; import java.io.*; public class Context {
   public static final int MODE_PRIVATE=0; private final Map<String,SharedPreferences> values=new HashMap<>();
   private final File directory=new File(System.getProperty("java.io.tmpdir"),"service-files-"+UUID.randomUUID());
   public Context() { if(!directory.mkdirs()) throw new IllegalStateException("Test directory unavailable"); }
   public SharedPreferences getSharedPreferences(String key,int mode) { return values.computeIfAbsent(key, ignored -> new SharedPreferences()); }
   public File getFilesDir() { return directory; }
  }`,
  'android/content/SharedPreferences.java': `package android.content; import java.util.*; public class SharedPreferences { private final Map<String,String> values=new HashMap<>(); public String getString(String key,String fallback) { return values.getOrDefault(key,fallback); } public Editor edit() { return new Editor(); } public class Editor { final Map<String,String> changed=new HashMap<>(); public Editor putString(String key,String value) { changed.put(key,value); return this; } public boolean commit() { values.putAll(changed); return true; } } }`,
  'android/util/Base64.java': `package android.util; public class Base64 { public static final int NO_WRAP=2; public static String encodeToString(byte[] bytes,int flags) { return java.util.Base64.getEncoder().encodeToString(bytes); } }`,
  'android/util/AtomicFile.java': `package android.util; import java.io.*; import java.nio.file.*; public class AtomicFile {
   public static boolean failRead,failStart,failBody,failFinish; public static int rollbacks; private final File base;
   public AtomicFile(File value) { base=value; } public File getBaseFile() { return base; }
   public FileInputStream openRead() throws IOException { if(failRead)throw new IOException("Test read failure"); return new FileInputStream(base); }
   public FileOutputStream startWrite() throws IOException { if(failStart)throw new IOException("Test start failure"); return new FileOutputStream(base.getPath()+".new") { @Override public void write(byte[] bytes) throws IOException { if(failBody) { super.write(bytes,0,Math.min(1,bytes.length)); throw new IOException("Test partial write failure"); } super.write(bytes); } }; }
   public void finishWrite(FileOutputStream output) { try { output.close(); if(!failFinish)Files.move(Path.of(base.getPath()+".new"),base.toPath(),StandardCopyOption.REPLACE_EXISTING,StandardCopyOption.ATOMIC_MOVE); } catch(IOException error) { throw new RuntimeException(error); } }
   public void failWrite(FileOutputStream output) { rollbacks++; try { output.close(); Files.deleteIfExists(Path.of(base.getPath()+".new")); } catch(IOException error) { throw new RuntimeException(error); } }
  }`,
  'com/batteryinventory/service/SecureSessionStore.java': `package com.batteryinventory.service; final class SecureSessionStore {
   static Session stored; static boolean inaccessible; static int clears;
   static final class Session { final String origin,token; final long expiresAt; Session(String origin,String token,long expiry) { this.origin=origin; this.token=token; expiresAt=expiry; } }
   SecureSessionStore(android.content.Context ignored) {}
   Session load(long now) throws Exception { if (inaccessible) throw new Exception("Test vault inaccessible"); if (stored!=null && stored.expiresAt<=now) clear(); return stored; }
   void save(Session session) { stored=session; } void clear() { stored=null; inaccessible=false; clears++; }
  }`,
  'okhttp3/CookieJar.java': `package okhttp3; public interface CookieJar { CookieJar NO_COOKIES = new CookieJar() {}; }`,
  'okhttp3/MediaType.java': `package okhttp3; public class MediaType { public static MediaType get(String type) { return new MediaType(); } }`,
  'okhttp3/RequestBody.java': `package okhttp3; public class RequestBody { public final String body; RequestBody(String value) { body=value; } public static RequestBody create(String value,MediaType type) { return new RequestBody(value); } }`,
  'okhttp3/Request.java': `package okhttp3; import java.util.*; public class Request { public String url,method; public RequestBody body; public final Map<String,String> headers=new HashMap<>(); public static class Builder { final Request value=new Request(); public Builder url(String url) { value.url=url; return this; } public Builder header(String key,String text) { value.headers.put(key.toLowerCase(Locale.ROOT),text); return this; } public Builder post(RequestBody body) { value.method="POST"; value.body=body; return this; } public Builder get() { value.method="GET"; return this; } public Request build() { return value; } } }`,
  'okhttp3/ResponseBody.java': `package okhttp3; import java.io.*; public class ResponseBody { public byte[] bytes; public long length; public ResponseBody(byte[] value) { bytes=value; length=value.length; } public long contentLength() { return length; } public InputStream byteStream() { return new ByteArrayInputStream(bytes); } }`,
  'okhttp3/Response.java': `package okhttp3; import java.util.*; public class Response implements AutoCloseable { public int status=200; public boolean closed; public ResponseBody body; public final Map<String,List<String>> headers=new HashMap<>(); public int code() { return status; } public boolean isSuccessful() { return status>=200 && status<300; } public List<String> headers(String key) { return headers.getOrDefault(key.toLowerCase(Locale.ROOT),List.of()); } public String header(String key) { var values=headers(key); return values.isEmpty()?null:values.get(0); } public ResponseBody body() { return body; } public void close() { closed=true; } }`,
  'okhttp3/Call.java': `package okhttp3; public interface Call { Response execute() throws java.io.IOException; void cancel(); }`,
  'okhttp3/OkHttpClient.java': `package okhttp3; import java.util.*; import java.util.concurrent.*; public class OkHttpClient {
   public static final List<Request> requests=new CopyOnWriteArrayList<>(); public static final Queue<Object> replies=new ConcurrentLinkedQueue<>(); public static Builder latest;
   public static class Builder { public CookieJar cookies; public boolean redirects=true,sslRedirects=true,retry=true; public Object cache;
    public Builder cookieJar(CookieJar value) { cookies=value; return this; } public Builder followRedirects(boolean value) { redirects=value; return this; } public Builder followSslRedirects(boolean value) { sslRedirects=value; return this; } public Builder retryOnConnectionFailure(boolean value) { retry=value; return this; } public Builder cache(Object value) { cache=value; return this; } public Builder connectTimeout(long n,TimeUnit u) { return this; } public Builder readTimeout(long n,TimeUnit u) { return this; } public Builder callTimeout(long n,TimeUnit u) { return this; } public OkHttpClient build() { latest=this; return new OkHttpClient(); }
   }
   public static class Pool { public void evictAll() {} } public Pool connectionPool() { return new Pool(); }
   public Call newCall(Request request) { return new Call() { public Response execute() throws java.io.IOException { requests.add(request); Object response=replies.remove(); if (response instanceof java.io.IOException) throw (java.io.IOException)response; return (Response)response; } public void cancel() {} }; }
  }`,
  'com/batteryinventory/service/BridgeHarness.java': `package com.batteryinventory.service;
import com.getcapacitor.*; import okhttp3.*; import java.util.*; import java.nio.charset.*; import java.nio.file.*; import android.util.AtomicFile;
public class BridgeHarness {
 static int checks; static class Subject extends BatteryServicePlugin { void destroy() { handleOnDestroy(); } }
 static void check(boolean value,String label) { if (!value) throw new AssertionError(label); checks++; }
 static PluginCall waitFor(PluginCall call) throws Exception { long until=System.nanoTime()+2_000_000_000L; while(call.settled==0 && System.nanoTime()<until) Thread.sleep(1); check(call.settled==1,"one terminal result"); return call; }
 static PluginCall get(Subject subject) throws Exception { PluginCall c=new PluginCall(); subject.getConfiguration(c); return waitFor(c); }
 static PluginCall configure(Subject subject,String origin) throws Exception { PluginCall c=new PluginCall(); c.data.put("origin",origin); subject.configure(c); return waitFor(c); }
 static PluginCall send(Subject subject,String path,String method,String body,JSObject headers) throws Exception { PluginCall c=new PluginCall(); c.data.put("path",path).put("method",method); if(body!=null)c.data.put("body",body); if(headers!=null)c.data.put("headers",headers); subject.request(c); return waitFor(c); }
 static Response response(int status,String type,byte[] bytes) { Response r=new Response(); r.status=status; r.body=new ResponseBody(bytes); r.headers.put("content-type",List.of(type)); return r; }
 static Response json(int status) { return response(status,"application/json", "{}".getBytes(StandardCharsets.UTF_8)); }
 static String cookie(String token) { return "inventory_session="+token+"; Path=/; HttpOnly; Secure; Max-Age=28800"; }
 static void failure(PluginCall call,String code) { check(code.equals(call.code),"expected "+code); check(call.result==null,"no success on failure"); }
 static PluginCall load(Subject subject) throws Exception { PluginCall c=new PluginCall(); subject.loadBusinessData(c); return waitFor(c); }
 static PluginCall save(Subject subject,Object data) throws Exception { PluginCall c=new PluginCall(); c.data.put("data",data).put("path","../../injected.json"); subject.saveBusinessData(c); return waitFor(c); }
 public static void main(String[] ignored) throws Exception {
  Subject subject=new Subject(); subject.load();
  try {
   check(OkHttpClient.latest.cookies==CookieJar.NO_COOKIES && !OkHttpClient.latest.redirects && !OkHttpClient.latest.sslRedirects && !OkHttpClient.latest.retry && OkHttpClient.latest.cache==null,"isolated HTTP controls");
   check(get(subject).result.get("origin")==org.json.JSONObject.NULL,"unconfigured origin");
   check(load(subject).result.get("data")==org.json.JSONObject.NULL,"missing business file only returns null");
   String setup="{unconfigured draft}"; check(save(subject,setup).code==null && load(subject).result.get("data").equals(setup),"unconfigured durable draft roundtrip");
   failure(send(subject,"/api/session","GET",null,null),"CONFIGURATION"); check(OkHttpClient.requests.isEmpty(),"unconfigured request not sent");
   check(configure(subject,"https://inventory.example").code==null,"configure succeeds");
   check(load(subject).result.get("data")==org.json.JSONObject.NULL,"configured scope does not reuse setup draft");
   String original="{pending exact request and earlier queue é}";
   check(save(subject,original).code==null && load(subject).result.get("data").equals(original),"business envelope preserves exact Unicode content");
   var dataFiles=subject.getContext().getFilesDir().listFiles(); check(dataFiles.length==2,"fixed origin-scoped files only");
   for(var f:dataFiles)check(f.getName().matches("battery-service-business-v1-[a-f0-9]{64}\\\\.json"),"SHA256 file name does not expose origin or caller path");
   failure(save(subject,123),"INVALID_BUSINESS_DATA"); failure(save(subject,new String(new char[]{0xd800})),"INVALID_BUSINESS_DATA"); failure(save(subject,"é".repeat(BusinessDataStore.MAX_BYTES/2+1)),"BUSINESS_DATA_TOO_LARGE"); check(load(subject).result.get("data").equals(original),"oversized or invalid save preserves old data");
   AtomicFile.failStart=true; failure(save(subject,"new failed draft"),"BUSINESS_STORAGE"); AtomicFile.failStart=false; check(load(subject).result.get("data").equals(original),"start failure preserves old committed envelope");
   AtomicFile.failBody=true; failure(save(subject,"new partial draft"),"BUSINESS_STORAGE"); AtomicFile.failBody=false; check(AtomicFile.rollbacks>0 && load(subject).result.get("data").equals(original),"partial write rolls back without deleting old data");
   AtomicFile.failFinish=true; failure(save(subject,"uncommitted rename"),"BUSINESS_STORAGE"); AtomicFile.failFinish=false; check(load(subject).result.get("data").equals(original),"readback catches failed replacement with old data intact");
   AtomicFile.failRead=true; failure(load(subject),"BUSINESS_STORAGE"); AtomicFile.failRead=false; check(load(subject).result.get("data").equals(original),"read error preserves data and is not mistaken for missing");
   var businessFile=Arrays.stream(subject.getContext().getFilesDir().listFiles()).filter(f -> { try{return Files.readString(f.toPath()).equals(original);}catch(Exception error){return false;} }).findFirst().orElseThrow();
   byte[] invalidUtf8=new byte[]{(byte)0xc3,0x28}; Files.write(businessFile.toPath(),invalidUtf8); failure(load(subject),"BUSINESS_DATA_CORRUPT"); check(Arrays.equals(Files.readAllBytes(businessFile.toPath()),invalidUtf8),"UTF8 corruption is preserved verbatim"); Files.writeString(businessFile.toPath(),original);
   Files.write(businessFile.toPath(),new byte[BusinessDataStore.MAX_BYTES+1]); failure(load(subject),"BUSINESS_DATA_TOO_LARGE"); check(Files.size(businessFile.toPath())==BusinessDataStore.MAX_BYTES+1L,"oversized saved file is preserved, never truncated"); Files.writeString(businessFile.toPath(),original);
   String token="a".repeat(64); Response login=json(200); login.headers.put("set-cookie",List.of(cookie(token))); login.headers.put("x-secret",List.of("private")); OkHttpClient.replies.add(login);
   PluginCall signed=send(subject,"/api/session","POST","{}",new JSObject().put("content-type","application/json"));
   check(signed.result.get("encoding").equals("utf8") && signed.result.get("body").equals("{}"),"JSON reply preserved");
   JSObject allowed=(JSObject)signed.result.get("headers"); check(!allowed.has("set-cookie") && !allowed.has("x-secret"),"no credential headers returned");
   check(SecureSessionStore.stored.token.equals(token),"credential retained in native vault abstraction");
   check(!OkHttpClient.requests.get(0).headers.containsKey("cookie") && !OkHttpClient.requests.get(0).headers.containsKey("origin"),"signin no external cookie or Origin");
   failure(configure(subject,"https://other.example"),"SESSION_EXISTS");
   OkHttpClient.replies.add(json(200)); send(subject,"/api/inventory?dataset=demo","GET",null,new JSObject().put("accept","application/json"));
   check(OkHttpClient.requests.get(1).headers.get("cookie").equals("inventory_session="+token),"internally captured host-bound cookie");
   int before=OkHttpClient.requests.size(); failure(send(subject,"/api/inventory","POST","{}",new JSObject().put("Cookie","forged")),"INVALID_HEADERS"); check(OkHttpClient.requests.size()==before,"header forgery not sent");
   byte[] binary=new byte[]{0,(byte)255,0,7}; Response exported=response(200,"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",binary); exported.headers.put("content-disposition",List.of("attachment; filename=battery.xlsx")); OkHttpClient.replies.add(exported);
   PluginCall file=send(subject,"/api/export","POST","{}",null); check(file.result.get("encoding").equals("base64") && file.result.get("body").equals(Base64.getEncoder().encodeToString(binary)),"every binary byte retained"); check(((JSObject)file.result.get("headers")).has("content-disposition"),"export filename metadata retained");
   Response redirected=json(302); redirected.headers.put("location",List.of("https://evil.example")); OkHttpClient.replies.add(redirected); before=OkHttpClient.requests.size(); failure(send(subject,"/api/session","GET",null,null),"REDIRECT_DENIED"); check(OkHttpClient.requests.size()==before+1 && redirected.closed,"redirect response closed with no second request");
   Response huge=json(200); huge.body.length=ServicePolicy.MAX_RESPONSE_BYTES+1L; OkHttpClient.replies.add(huge); failure(send(subject,"/api/export","POST","{}",null),"RESPONSE_TOO_LARGE"); check(huge.closed,"oversized response closed without partial export");
   OkHttpClient.replies.add(new java.io.IOException("Test transport lost response")); failure(send(subject,"/api/inventory","POST","{}",null),"NETWORK_UNCERTAIN"); check(SecureSessionStore.stored!=null,"network uncertainty does not silently forget credential");
   OkHttpClient.replies.add(json(401)); send(subject,"/api/inventory","GET",null,null); check(SecureSessionStore.stored==null,"401 clears local credential");
   SecureSessionStore.inaccessible=true; check(get(subject).result.get("origin").equals("https://inventory.example"),"configuration survives inaccessible vault"); failure(send(subject,"/api/session","GET",null,null),"SECURE_STORAGE"); PluginCall reset=new PluginCall(); subject.clearSession(reset); waitFor(reset); check(!SecureSessionStore.inaccessible,"explicit reset repairs inaccessible vault abstraction");
   check(configure(subject,"https://other.example").code==null,"origin switch after reset");
   check(load(subject).result.get("data")==org.json.JSONObject.NULL,"another origin cannot load prior business envelope");
   check(configure(subject,"https://inventory.example").code==null && load(subject).result.get("data").equals(original),"original scoped business data survives session reset and origin change");
   check(configure(subject,"https://other.example").code==null,"restore new test origin");
   SecureSessionStore.stored=new SecureSessionStore.Session("https://inventory.example",token,System.currentTimeMillis()+10000); before=OkHttpClient.requests.size(); failure(send(subject,"/api/inventory","GET",null,null),"SESSION_ORIGIN_MISMATCH"); check(OkHttpClient.requests.size()==before,"mismatched credential cannot cross origin");
   PluginCall clear=new PluginCall(); subject.clearSession(clear); waitFor(clear); SecureSessionStore.stored=new SecureSessionStore.Session("https://other.example",token,System.currentTimeMillis()+10000);
   Response out=json(200); out.headers.put("set-cookie",List.of("inventory_session=; Path=/; HttpOnly; Secure; Max-Age=0")); OkHttpClient.replies.add(out); send(subject,"/api/session","POST","{signout}",null); check(SecureSessionStore.stored==null,"signout clears secure credential");
   System.out.println("Passed "+checks+" controlled assertions against production Android bridge. HTTP, vault and SDK doubles are not device acceptance.");
  } finally { subject.destroy(); }
 }
}`,
};

test('production Android bridge keeps session native and returns only complete clean replies', { timeout: 30000 }, async context => {
  const version = spawnSync(executable('javac'), ['-version'], { encoding: 'utf8', windowsHide: true });
  if (version.error) return context.skip('JDK unavailable; controlled bridge execution not performed.');
  await mkdir(path.join(root, 'work'), { recursive: true });
  const work = await mkdtemp(path.join(root, 'work/bridge-'));
  const files = [];
  for (const [relative, source] of Object.entries(sources)) {
    const file = path.join(work, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
    files.push(file);
  }
  const compile = spawnSync(executable('javac'), ['-d', work,
    path.join(root, 'android/src/main/java/com/batteryinventory/service/ServicePolicy.java'),
    path.join(root, 'android/src/main/java/com/batteryinventory/service/BusinessDataStore.java'),
    path.join(root, 'android/src/main/java/com/batteryinventory/service/BatteryServicePlugin.java'), ...files], { encoding: 'utf8', windowsHide: true });
  assert.equal(compile.status, 0, compile.stdout + compile.stderr);
  const run = spawnSync(executable('java'), [`-Djava.io.tmpdir=${work}`, '-cp', work, 'com.batteryinventory.service.BridgeHarness'], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  context.diagnostic(run.stdout.trim());
});
