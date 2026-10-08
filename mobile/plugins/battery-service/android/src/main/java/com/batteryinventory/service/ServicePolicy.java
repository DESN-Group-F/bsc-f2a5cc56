package com.batteryinventory.service;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.text.ParsePosition;
import java.text.SimpleDateFormat;
import java.util.*;

/** Pure transport boundaries, shared by production Java and controlled tests. */
final class ServicePolicy {
    static final String COOKIE = "inventory_session";
    static final long SESSION_MILLIS = 8L * 60 * 60 * 1000;
    static final int MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
    static final Set<String> ROUTES = Collections.unmodifiableSet(new HashSet<>(Arrays.asList(
        "/api/session", "/api/inventory", "/api/accounts", "/api/battery-models",
        "/api/teaching-groups", "/api/task-plans", "/api/messages", "/api/export"
    )));

    static final class Failure extends Exception {
        final String code;
        Failure(String message, String code) { super(message); this.code = code; }
    }
    static final class CookieUpdate {
        final boolean present;
        final String token;
        final long expiresAt;
        CookieUpdate(boolean present, String token, long expiresAt) { this.present = present; this.token = token; this.expiresAt = expiresAt; }
    }

    static String origin(String value) throws Failure {
        try {
            if (value == null) throw new IllegalArgumentException();
            URI uri = new URI(value.trim());
            String host = uri.getHost();
            String path = uri.getRawPath();
            int port = uri.getPort();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || host.isEmpty()
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || path != null && !path.isEmpty() && !path.equals("/") || port == 0 || port > 65535)
                throw new IllegalArgumentException();
            return "https://" + host.toLowerCase(Locale.ROOT) + (port == -1 || port == 443 ? "" : ":" + port);
        } catch (Exception ignored) {
            throw new Failure("Enter a trusted HTTPS origin without a path, query, fragment or credentials.", "INVALID_ORIGIN");
        }
    }

    static URI requestUri(String origin, String path) throws Failure {
        try {
            if (path == null || path.length() > 24000 || !path.startsWith("/") || path.startsWith("//") || path.contains("\\")) throw new IllegalArgumentException();
            URI relative = new URI(path);
            if (relative.isAbsolute() || relative.getRawAuthority() != null || relative.getRawFragment() != null
                || !ROUTES.contains(relative.getRawPath()) || !relative.getRawPath().equals(relative.getPath())) throw new IllegalArgumentException();
            URI result = new URI(origin + path);
            if (!origin.equals(origin(result.getScheme() + "://" + result.getRawAuthority()))) throw new IllegalArgumentException();
            return result;
        } catch (Exception ignored) { throw new Failure("Use an allowed inventory API path and query only.", "INVALID_PATH"); }
    }

    static void request(String path, String method, String body, Map<String, String> headers) throws Failure {
        if (!"GET".equals(method) && !"POST".equals(method)) throw new Failure("Only GET and POST are supported.", "INVALID_METHOD");
        if ("GET".equals(method) && body != null) throw new Failure("GET requests cannot contain a body.", "INVALID_BODY");
        int limit = path.equals("/api/session") ? 5000 : path.equals("/api/export") ? 15000 : 250000;
        if (body != null && body.getBytes(StandardCharsets.UTF_8).length > limit) throw new Failure("This request exceeds its API size limit. Nothing was sent.", "REQUEST_TOO_LARGE");
        Set<String> seen = new HashSet<>();
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            String key = entry.getKey().toLowerCase(Locale.ROOT), value = entry.getValue();
            if (!seen.add(key) || !key.equals("content-type") && !key.equals("accept") || value == null || value.length() > 256
                || !value.matches("[\\x20-\\x7e]+")) throw new Failure("Only safe Content-Type and Accept headers are allowed.", "INVALID_HEADERS");
            if (key.equals("content-type") && !value.toLowerCase(Locale.ROOT).matches("application/json(?:;\\s*charset=utf-8)?"))
                throw new Failure("Send request bodies as application/json.", "INVALID_HEADERS");
        }
    }

    static CookieUpdate cookie(List<String> headers, long now) throws Failure {
        CookieUpdate result = new CookieUpdate(false, null, 0);
        for (String raw : headers) {
            String[] parts = raw.split(";", -1);
            if (parts.length == 0 || !parts[0].trim().startsWith(COOKIE + "=")) continue;
            if (result.present) throw new Failure("The service returned conflicting session cookies. Sign in again.", "SESSION_COOKIE_INVALID");
            String token = parts[0].trim().substring(COOKIE.length() + 1);
            Map<String, String> attributes = new HashMap<>();
            for (int i = 1; i < parts.length; i++) {
                String part = parts[i].trim();
                int equal = part.indexOf('=');
                String key = (equal < 0 ? part : part.substring(0, equal)).toLowerCase(Locale.ROOT);
                if (attributes.put(key, equal < 0 ? "" : part.substring(equal + 1)) != null)
                    throw new Failure("The service returned an invalid session cookie. Sign in again.", "SESSION_COOKIE_INVALID");
            }
            if (!attributes.containsKey("httponly") || !attributes.containsKey("secure") || !"/".equals(attributes.get("path"))
                || attributes.containsKey("domain")) throw new Failure("The service did not return a secure host-only session cookie.", "SESSION_COOKIE_INVALID");
            long expiry = now + SESSION_MILLIS;
            try {
                if (attributes.containsKey("max-age")) {
                    long seconds = Long.parseLong(attributes.get("max-age"));
                    expiry = seconds <= 0 ? now : now + Math.min(seconds, SESSION_MILLIS / 1000) * 1000;
                } else if (attributes.containsKey("expires")) {
                    SimpleDateFormat format = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
                    format.setLenient(false);
                    ParsePosition position = new ParsePosition(0);
                    Date date = format.parse(attributes.get("expires"), position);
                    if (date == null || position.getIndex() != attributes.get("expires").length()) throw new IllegalArgumentException();
                    expiry = Math.min(expiry, date.getTime());
                } else throw new IllegalArgumentException();
            } catch (Exception ignored) { throw new Failure("The service returned an invalid session expiry. Sign in again.", "SESSION_COOKIE_INVALID"); }
            if (token.isEmpty() || expiry <= now) result = new CookieUpdate(true, null, 0);
            else {
                if (!token.matches("[a-f0-9]{64}")) throw new Failure("The service returned an invalid session cookie. Sign in again.", "SESSION_COOKIE_INVALID");
                result = new CookieUpdate(true, token, expiry);
            }
        }
        return result;
    }

    static boolean textContent(String contentType) {
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT).split(";", 2)[0].trim();
        return type.startsWith("text/") || type.equals("application/json") || type.endsWith("+json");
    }
}
