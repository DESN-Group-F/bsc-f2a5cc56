package com.batteryinventory.nfc;

import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.nfc.tech.NfcA;
import android.os.Handler;
import android.os.Looper;
import androidx.lifecycle.Lifecycle;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONObject;

@CapacitorPlugin(name = "BatteryNfc")
public class BatteryNfcPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private NfcAdapter adapter;
    private ReadSession active;
    private boolean destroyed;

    // Session identity and promise completion are owned by the main thread.
    // Only stopped crosses to the I/O thread; results cross back as completed values.
    private static final class ReadSession {
        final PluginCall call;
        Runnable timeout;
        Ndef connection;
        boolean readerEnabled;
        boolean claimed;
        boolean ioStarted;
        boolean ioDone;
        boolean closeStarted;
        boolean closeDone;
        boolean settled;
        volatile boolean stopped;
        String uid;
        String observedAt;
        ReadSession(PluginCall call) { this.call = call; }
    }

    @Override
    public void load() {
        adapter = NfcAdapter.getDefaultAdapter(getContext());
    }

    @PluginMethod
    public void getAvailability(PluginCall call) {
        main.post(() -> {
            JSObject result = new JSObject();
            boolean available = adapter != null && !destroyed;
            boolean enabled = available && adapter.isEnabled();
            result.put("available", available);
            result.put("enabled", enabled);
            result.put("platform", "android");
            if (!available) result.put("reason", "NFC hardware is unavailable on this device.");
            else if (!enabled) result.put("reason", "Enable NFC in Android settings before starting a read.");
            call.resolve(result);
        });
    }

    @PluginMethod
    public void read(PluginCall call) {
        main.post(() -> {
            if (active != null) {
                call.reject(active.settled ? "The previous NFC read is still closing. Try again shortly." : "An NFC read is already running.", "BUSY");
                return;
            }
            if (destroyed || adapter == null) {
                call.reject("NFC hardware is unavailable on this device.", "UNAVAILABLE"); return;
            }
            if (!adapter.isEnabled()) {
                call.reject("Enable NFC in Android settings before starting a read.", "DISABLED"); return;
            }
            if (getActivity() == null || !getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED)) {
                call.reject("Keep the app in the foreground to read a tag.", "BACKGROUND"); return;
            }
            int timeoutMs = 20_000;
            if (call.getData().has("timeoutMs")) {
                Object supplied = call.getData().opt("timeoutMs");
                if (!(supplied instanceof Number)) {
                    call.reject("timeoutMs must be an integer from 1000 to 60000.", "INVALID_ARGUMENT"); return;
                }
                double value = ((Number) supplied).doubleValue();
                if (!Double.isFinite(value) || value != Math.rint(value) || value < 1_000 || value > 60_000) {
                    call.reject("timeoutMs must be an integer from 1000 to 60000.", "INVALID_ARGUMENT"); return;
                }
                timeoutMs = (int) value;
            }
            ReadSession session = new ReadSession(call);
            active = session;
            session.timeout = () -> fail(session, "The NFC read timed out.", "TIMEOUT", true);
            main.postDelayed(session.timeout, timeoutMs);
            try {
                // Keep Android's NDEF discovery enabled, including initialized blank tags.
                // The callback captures this session rather than looking up a newer pending call.
                session.readerEnabled = true;
                adapter.enableReaderMode(getActivity(), tag -> main.post(() -> acceptTag(session, tag)), NfcAdapter.FLAG_READER_NFC_A, null);
            } catch (RuntimeException error) {
                fail(session, errorText(error), "NFC_SESSION", false);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> {
            if (active != null) fail(active, "NFC reading was cancelled.", "CANCELLED", false);
            call.resolve();
        });
    }

    private void acceptTag(ReadSession session, Tag tag) {
        if (active != session || session.settled || session.claimed) return;
        session.claimed = true;
        if (tag == null || NfcA.get(tag) == null) {
            fail(session, "This diagnostic reader supports NFC-A tags such as NTAG213.", "UNSUPPORTED_TAG", false); return;
        }
        byte[] uid = tag.getId();
        if (uid == null || uid.length == 0) {
            fail(session, "The reader did not return a tag identifier.", "NO_UID", false); return;
        }
        session.uid = hex(uid);
        session.observedAt = timestamp();
        try {
            session.connection = Ndef.get(tag);
        } catch (RuntimeException error) {
            fail(session, errorText(error), "NDEF_STATUS", true); return;
        }
        if (session.connection == null) {
            JSObject result = baseResult(session);
            // Not enumerated means unsupported or unformatted on this reader, not an empty message.
            result.put("ndefStatus", "notSupported");
            finish(session, result, null, null);
            return;
        }
        session.ioStarted = true;
        final Ndef connection = session.connection;
        Thread reader = new Thread(() -> readNdef(session, connection), "Battery NFC read");
        reader.setDaemon(true);
        reader.start();
    }

    private void readNdef(ReadSession session, Ndef connection) {
        JSObject result = baseResult(session);
        try {
            if (session.stopped) return;
            result.put("ndefStatus", connection.isWritable() ? "readWrite" : "readOnly");
            int capacity = connection.getMaxSize();
            result.put("capacityBytes", capacity >= 0 ? capacity : JSONObject.NULL);
            connection.connect();
            if (session.stopped) return;
            // A null message is valid for an initialized blank tag. Do not invent records or format it.
            NdefMessage message = connection.getNdefMessage();
            JSArray records = new JSArray();
            if (message != null) {
                for (NdefRecord record : message.getRecords()) {
                    JSObject encoded = new JSObject();
                    encoded.put("tnf", (int) record.getTnf());
                    encoded.put("typeHex", hex(record.getType()));
                    encoded.put("idHex", hex(record.getId()));
                    encoded.put("payloadHex", hex(record.getPayload()));
                    records.put(encoded);
                }
            }
            result.put("records", records);
        } catch (Exception error) {
            result.put("ndefError", "NDEF_READ: " + errorText(error));
        } finally {
            closeQuietly(connection);
            main.post(() -> {
                session.ioDone = true;
                session.connection = null;
                if (active != session) return;
                if (!session.settled) finish(session, result, null, null);
                // A cancelled read retains the busy guard until its I/O actually exits.
                // Its old callback can never resolve or disable a later reader session.
                releaseFinished(session);
            });
        }
    }

    private void fail(ReadSession session, String message, String code, boolean preserveUid) {
        if (active != session || session.settled) return;
        if (preserveUid && session.uid != null) {
            JSObject result = baseResult(session);
            result.put("ndefError", code + ": " + message);
            finish(session, result, null, null);
        } else finish(session, null, message, code);
    }

    private void finish(ReadSession session, JSObject result, String error, String code) {
        if (active != session || session.settled) return;
        session.settled = true;
        session.stopped = true;
        main.removeCallbacks(session.timeout);
        String cleanupError = null;
        if (session.readerEnabled) {
            try { adapter.disableReaderMode(getActivity()); }
            catch (RuntimeException failure) { cleanupError = errorText(failure); }
            session.readerEnabled = false;
        }
        if (session.ioStarted && !session.ioDone && session.connection != null) {
            // close() cancels blocked connect/read calls; use a separate thread so
            // a vendor's NFC binder cannot block the UI, cancellation or timeout result.
            final Ndef connection = session.connection;
            session.closeStarted = true;
            Thread closer = new Thread(() -> {
                closeQuietly(connection);
                main.post(() -> {
                    session.closeDone = true;
                    releaseFinished(session);
                });
            }, "Battery NFC close");
            closer.setDaemon(true);
            closer.start();
        }
        releaseFinished(session);
        if (result != null) {
            if (cleanupError != null) {
                String previous = result.optString("ndefError", "");
                result.put("ndefError", (previous.isEmpty() ? "" : previous + "; ") + "NFC_CLEANUP: " + cleanupError);
            }
            session.call.resolve(result);
        } else session.call.reject(error + (cleanupError == null ? "" : " NFC cleanup: " + cleanupError), code);
    }

    private void releaseFinished(ReadSession session) {
        if (active == session && session.settled && (!session.ioStarted || session.ioDone)
            && (!session.closeStarted || session.closeDone)) active = null;
    }

    @Override
    protected void handleOnPause() {
        main.post(() -> {
            if (active != null) fail(active, "NFC reading stopped because the app left the foreground.", "BACKGROUND", false);
        });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true;
            if (active != null) fail(active, "NFC reading stopped because the app closed.", "CANCELLED", false);
        });
    }

    private static JSObject baseResult(ReadSession session) {
        JSObject result = new JSObject();
        result.put("uidHex", session.uid);
        result.put("technology", "NFC-A / ISO 14443");
        result.put("ndefStatus", "unknown");
        result.put("capacityBytes", JSONObject.NULL);
        result.put("records", new JSArray());
        result.put("observedAt", session.observedAt);
        return result;
    }

    private static void closeQuietly(Ndef connection) {
        try { connection.close(); } catch (Exception ignored) { /* Session is already ending. */ }
    }

    private static String hex(byte[] bytes) {
        char[] alphabet = "0123456789ABCDEF".toCharArray();
        char[] result = new char[bytes.length * 2];
        for (int index = 0; index < bytes.length; index++) {
            int value = bytes[index] & 0xff;
            result[index * 2] = alphabet[value >>> 4];
            result[index * 2 + 1] = alphabet[value & 0x0f];
        }
        return new String(result);
    }

    private static String timestamp() {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(new Date());
    }

    private static String errorText(Exception error) {
        return error.getClass().getSimpleName() + ": " + (error.getMessage() == null ? "NFC operation failed." : error.getMessage());
    }
}
