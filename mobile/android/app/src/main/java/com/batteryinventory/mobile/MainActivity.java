package com.batteryinventory.mobile;

import com.getcapacitor.BridgeActivity;
import android.app.PendingIntent;
import android.content.Intent;
import android.nfc.NfcAdapter;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    private static final String NFC_LOG_TAG = "BatteryInventoryNfc";
    private NfcAdapter foregroundNfc;

    @Override public void onCreate(Bundle savedInstanceState) {
        PhoneStartupBridge startup = PhoneStartupBridge.install(this, getLifecycle());
        bridgeBuilder.addWebViewListener(startup);
        registerPlugin(BatteryUiPlugin.class);
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(getWindow().getDecorView());
                if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
                    new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView()).hide(WindowInsetsCompat.Type.ime());
                    return;
                }
                if (bridge != null) bridge.triggerWindowJSEvent("battery-mobile-back");
            }
        });
    }

    @Override public void onResume() {
        super.onResume();
        try {
            foregroundNfc = NfcAdapter.getDefaultAdapter(this);
            if (foregroundNfc == null) return;
            Intent target = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
            // NFC supplies the tag action and extras. Older Android versions are mutable by default.
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
            PendingIntent dispatch = PendingIntent.getActivity(this, 0, target, flags);
            // This is a foreground routing guard, not an acquisition session. Reader mode
            // retains priority; between explicit reads all tags stay in this Activity.
            foregroundNfc.enableForegroundDispatch(this, dispatch, null, null);
        } catch (UnsupportedOperationException | IllegalStateException | SecurityException error) {
            Log.w(NFC_LOG_TAG, "Foreground NFC dispatch protection could not be enabled.", error);
        }
    }

    @Override public void onPause() {
        try {
            // Disable before BridgeActivity/Activity completes its pause, including after
            // a failed enable attempt that may have partially registered with the platform.
            if (foregroundNfc != null) foregroundNfc.disableForegroundDispatch(this);
        } catch (UnsupportedOperationException | IllegalStateException | SecurityException error) {
            Log.w(NFC_LOG_TAG, "Foreground NFC dispatch protection could not be disabled.", error);
        } finally {
            foregroundNfc = null;
            super.onPause();
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)
            || NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)
            || NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)) {
            // Consume only routing intents, including a late delivery during pause.
            // No tag data is parsed, adopted or forwarded to the Capacitor bridge.
            return;
        }
        super.onNewIntent(intent);
    }
}
