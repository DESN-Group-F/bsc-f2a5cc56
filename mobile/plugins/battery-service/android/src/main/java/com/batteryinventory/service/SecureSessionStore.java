package com.batteryinventory.service;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** Session credentials are encrypted by a non-exportable app Keystore key. */
final class SecureSessionStore {
    private static final String ALIAS = "battery.inventory.service.session.v1";
    private final SharedPreferences preferences;
    static final class Session {
        final String origin, token;
        final long expiresAt;
        Session(String origin, String token, long expiresAt) { this.origin = origin; this.token = token; this.expiresAt = expiresAt; }
    }
    SecureSessionStore(Context context) { preferences = context.getSharedPreferences("battery_service_session", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    Session load(long now) throws Exception {
        String ciphertext = preferences.getString("ciphertext", null), iv = preferences.getString("iv", null);
        if (ciphertext == null && iv == null) return null;
        if (ciphertext == null || iv == null) throw new IllegalStateException("Incomplete secure session storage");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        JSONObject value = new JSONObject(new String(cipher.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), StandardCharsets.UTF_8));
        String origin = value.getString("origin"), token = value.getString("token");
        long expiresAt = value.getLong("expiresAt");
        if (!ServicePolicy.origin(origin).equals(origin) || !token.matches("[a-f0-9]{64}") || expiresAt > now + ServicePolicy.SESSION_MILLIS)
            throw new IllegalStateException("Invalid secure session storage");
        if (expiresAt <= now) { clear(); return null; }
        return new Session(origin, token, expiresAt);
    }
    void save(Session session) throws Exception {
        JSONObject value = new JSONObject().put("origin", session.origin).put("token", session.token).put("expiresAt", session.expiresAt);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        String ciphertext = Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!preferences.edit().putString("ciphertext", ciphertext).putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).commit())
            throw new IllegalStateException("Secure session storage did not commit");
    }
    void clear() throws Exception {
        if (!preferences.edit().clear().commit()) throw new IllegalStateException("Secure session removal did not commit");
    }
}
