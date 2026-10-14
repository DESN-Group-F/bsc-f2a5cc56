package com.batteryinventory.service;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.URI;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import okhttp3.*;
import org.json.JSONObject;
import org.json.JSONArray;

@CapacitorPlugin(name = "BatteryService")
public class BatteryServicePlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final OkHttpClient client = new OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .cache(null).connectTimeout(15, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(40, TimeUnit.SECONDS).build();
    private volatile Call active;
    private final Object transportLock = new Object();
    private final Set<ServiceJob> pending = new HashSet<>();
    private boolean destroyed;
    private SharedPreferences configuration;
    private SecureSessionStore sessions;

    @Override public void load() {
        configuration = getContext().getSharedPreferences("battery_service_configuration", Context.MODE_PRIVATE);
        sessions = new SecureSessionStore(getContext());
    }
    @FunctionalInterface private interface Work { void run() throws Exception; }
    private final class ServiceJob implements Runnable {
        private final PluginCall call;
        private final Work work;
        private final AtomicBoolean rejected = new AtomicBoolean();
        ServiceJob(PluginCall call, Work work) { this.call = call; this.work = work; }
        void unavailable() {
            if (rejected.compareAndSet(false, true)) call.reject("Native service transport is no longer available.", "UNAVAILABLE");
        }
        @Override public void run() {
            boolean admitted;
            synchronized (transportLock) { pending.remove(this); admitted = !destroyed; }
            if (!admitted) { unavailable(); return; }
            try { work.run(); }
            catch (ServicePolicy.Failure failure) { call.reject(failure.getMessage(), failure.code); }
            catch (Exception ignored) { call.reject("Native service processing failed. Preserve pending work before retrying.", "NATIVE_SERVICE_FAILURE"); }
        }
    }
    private void execute(PluginCall call, Work work) {
        ServiceJob job = new ServiceJob(call, work);
        synchronized (transportLock) {
            if (destroyed) { job.unavailable(); return; }
            pending.add(job);
            try { worker.execute(job); }
            catch (RejectedExecutionException ignored) { pending.remove(job); job.unavailable(); }
        }
    }
    private SecureSessionStore.Session session() throws ServicePolicy.Failure {
        try { return sessions.load(System.currentTimeMillis()); }
        catch (Exception ignored) { throw new ServicePolicy.Failure("Secure credential storage could not be read. Preserve pending work, then explicitly reset the local session and sign in again.", "SECURE_STORAGE"); }
    }
    private void clear() throws ServicePolicy.Failure {
        try { sessions.clear(); }
        catch (Exception ignored) { throw new ServicePolicy.Failure("Secure credential removal did not complete. Keep pending work and retry.", "SECURE_STORAGE"); }
    }
    private JSObject configurationResult() {
        return new JSObject().put("origin", configuration.getString("origin", null) == null ? JSONObject.NULL : configuration.getString("origin", null))
            .put("businessDataCodecs", new JSONArray().put(BusinessDataCodec.GZIP_BASE64));
    }

    @PluginMethod public void getConfiguration(PluginCall call) { execute(call, () -> call.resolve(configurationResult())); }
    @PluginMethod public void configure(PluginCall call) {
        execute(call, () -> {
            String origin = ServicePolicy.origin(call.getString("origin"));
            SecureSessionStore.Session session = session();
            if (session != null && !session.origin.equals(origin)) throw new ServicePolicy.Failure("Sign out before changing the service origin. Preserve pending work first.", "SESSION_EXISTS");
            if (!configuration.edit().putString("origin", origin).commit()) throw new ServicePolicy.Failure("Service configuration could not be saved.", "CONFIGURATION_STORAGE");
            call.resolve(configurationResult());
        });
    }
    @PluginMethod public void clearSession(PluginCall call) { execute(call, () -> { clear(); call.resolve(); }); }
    private BusinessDataStore businessData() throws ServicePolicy.Failure {
        String origin = configuration.getString("origin", null);
        String scope = origin == null || origin.isEmpty() ? "unconfigured" : ServicePolicy.origin(origin);
        return new BusinessDataStore(getContext(), scope);
    }
    @PluginMethod public void loadBusinessData(PluginCall call) {
        execute(call, () -> {
            String data = businessData().load();
            call.resolve(new JSObject().put("data", data == null ? JSONObject.NULL : data));
        });
    }
    @PluginMethod public void saveBusinessData(PluginCall call) {
        execute(call, () -> {
            String data = call.getString("data");
            if (data == null) throw new ServicePolicy.Failure("Provide the complete business envelope as a string.", "INVALID_BUSINESS_DATA");
            Object codec = call.getData().has("codec") ? call.getData().opt("codec") : null;
            businessData().save(BusinessDataCodec.decode(data, codec));
            call.resolve();
        });
    }

    @PluginMethod public void request(PluginCall call) {
        execute(call, () -> {
            String origin = configuration.getString("origin", null);
            if (origin == null) throw new ServicePolicy.Failure("Configure the trusted HTTPS service origin first.", "CONFIGURATION");
            origin = ServicePolicy.origin(origin);
            String path = call.getString("path"), method = call.getString("method");
            URI uri = ServicePolicy.requestUri(origin, path);
            String body = call.getString("body");
            if (call.getData().has("body") && !(call.getData().opt("body") instanceof String)) throw new ServicePolicy.Failure("Provide request bodies as JSON strings.", "INVALID_BODY");
            Map<String, String> headers = new HashMap<>();
            Object rawHeaders = call.getData().opt("headers");
            if (rawHeaders != null && !(rawHeaders instanceof JSONObject)) throw new ServicePolicy.Failure("Provide request headers as an object.", "INVALID_HEADERS");
            if (rawHeaders instanceof JSONObject) {
                JSONObject object = (JSONObject) rawHeaders;
                Iterator<String> keys = object.keys();
                while (keys.hasNext()) {
                    String key = keys.next(); Object value = object.opt(key);
                    if (!(value instanceof String)) throw new ServicePolicy.Failure("Request header values must be strings.", "INVALID_HEADERS");
                    headers.put(key, (String) value);
                }
            }
            ServicePolicy.request(uri.getPath(), method, body, headers);
            SecureSessionStore.Session session = session();
            if (session != null && !session.origin.equals(origin)) throw new ServicePolicy.Failure("The saved session belongs to another service origin. Preserve work and explicitly reset it.", "SESSION_ORIGIN_MISMATCH");
            Request.Builder builder = new Request.Builder().url(uri.toString());
            String type = "application/json";
            for (Map.Entry<String, String> header : headers.entrySet()) {
                builder.header(header.getKey(), header.getValue());
                if (header.getKey().equalsIgnoreCase("content-type")) type = header.getValue();
            }
            if (session != null) builder.header("Cookie", ServicePolicy.COOKIE + "=" + session.token);
            if (method.equals("POST")) builder.post(RequestBody.create(body == null ? "" : body, MediaType.get(type)));
            else builder.get();
            Call transfer = client.newCall(builder.build());
            synchronized (transportLock) {
                if (destroyed) throw new ServicePolicy.Failure("Native service transport is no longer available.", "UNAVAILABLE");
                active = transfer;
            }
            try (Response response = transfer.execute()) {
                if (response.code() >= 300 && response.code() < 400) throw new ServicePolicy.Failure("The service returned a redirect. No redirect was followed; review the configured origin.", "REDIRECT_DENIED");
                ServicePolicy.CookieUpdate update;
                try { update = ServicePolicy.cookie(response.headers("Set-Cookie"), System.currentTimeMillis()); }
                catch (ServicePolicy.Failure failure) { clear(); throw failure; }
                if (response.code() == 401 || update.present && update.token == null) clear();
                else if (update.present) {
                    try { sessions.save(new SecureSessionStore.Session(origin, update.token, update.expiresAt)); }
                    catch (Exception ignored) { throw new ServicePolicy.Failure("The secure session could not be saved. Sign-in is not confirmed locally.", "SECURE_STORAGE"); }
                }
                if (uri.getPath().equals("/api/session") && method.equals("POST") && response.isSuccessful() && body != null) {
                    try { if (new JSONObject(body).optString("action", "").equals("signout")) clear(); }
                    catch (ServicePolicy.Failure failure) { throw failure; }
                    catch (Exception ignored) { /* The server validates JSON; invalid input is not a successful signout. */ }
                }
                ResponseBody responseBody = response.body();
                if (responseBody != null && responseBody.contentLength() > ServicePolicy.MAX_RESPONSE_BYTES)
                    throw new ServicePolicy.Failure("The complete response exceeds the 32 MiB native transport limit. No partial export was returned; narrow its explicit scope.", "RESPONSE_TOO_LARGE");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                if (responseBody != null) try (InputStream input = responseBody.byteStream()) {
                    byte[] chunk = new byte[16384]; int count;
                    while ((count = input.read(chunk)) != -1) {
                        if (count > ServicePolicy.MAX_RESPONSE_BYTES - output.size()) throw new ServicePolicy.Failure("The complete response exceeds the 32 MiB native transport limit. No partial export was returned; narrow its explicit scope.", "RESPONSE_TOO_LARGE");
                        output.write(chunk, 0, count);
                    }
                }
                JSObject allowed = new JSObject();
                for (String name : Arrays.asList("content-type", "content-disposition")) {
                    String value = response.header(name);
                    if (value != null && value.length() <= 2048 && !value.contains("\r") && !value.contains("\n")) allowed.put(name, value);
                }
                byte[] bytes = output.toByteArray(); String encoding = "base64", value = null;
                if (ServicePolicy.textContent(response.header("content-type"))) {
                    try {
                        value = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
                        encoding = "utf8";
                    } catch (Exception ignored) { /* Preserve every byte when the declared text is not valid UTF-8. */ }
                }
                if (value == null) value = Base64.encodeToString(bytes, Base64.NO_WRAP);
                call.resolve(new JSObject().put("status", response.code()).put("headers", allowed).put("body", value).put("encoding", encoding));
            } catch (ServicePolicy.Failure failure) { throw failure; }
            catch (Exception ignored) { throw new ServicePolicy.Failure("No authoritative response was received. Preserve pending writes and retry their exact captured requests.", "NETWORK_UNCERTAIN"); }
            finally { if (active == transfer) active = null; }
        });
    }
    @Override protected void handleOnDestroy() {
        List<ServiceJob> queued;
        synchronized (transportLock) {
            if (destroyed) { super.handleOnDestroy(); return; }
            destroyed = true;
            queued = new ArrayList<>(pending);
            pending.clear();
        }
        // Cancellation and pool eviction may write TLS close_notify. Never run
        // either on the Activity thread or wait for cleanup during destruction.
        Thread cleanup = new Thread(() -> {
            for (ServiceJob job : queued) job.unavailable();
            try { worker.shutdownNow(); }
            catch (RuntimeException ignored) { Log.w("BatteryService", "Native service worker shutdown did not complete."); }
            Call transfer = active;
            try { if (transfer != null) transfer.cancel(); }
            catch (RuntimeException ignored) { Log.w("BatteryService", "Native service cancellation did not complete."); }
            try { client.connectionPool().evictAll(); }
            catch (RuntimeException ignored) { Log.w("BatteryService", "Native service connection cleanup did not complete."); }
        }, "battery-service-cleanup");
        cleanup.setDaemon(true);
        cleanup.start();
        super.handleOnDestroy();
    }
}
