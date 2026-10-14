package com.batteryinventory.mobile;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Short foreground feedback; availability is separate from physical acceptance. */
@CapacitorPlugin(name = "BatteryUi")
public class BatteryUiPlugin extends Plugin {
    @PluginMethod public void backgroundApp(PluginCall call) {
        if (getActivity() == null) { call.reject("The application window is unavailable."); return; }
        getActivity().runOnUiThread(() -> {
            JSObject result = new JSObject();
            result.put("backgrounded", getActivity().moveTaskToBack(true));
            call.resolve(result);
        });
    }
    @PluginMethod public void haptic(PluginCall call) {
        int duration = Math.max(1, Math.min(50, call.getInt("durationMs", 12)));
        Vibrator vibrator = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        boolean available = vibrator != null && vibrator.hasVibrator();
        if (available) {
            if (Build.VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            else vibrator.vibrate(duration);
        }
        JSObject result = new JSObject(); result.put("available", available); call.resolve(result);
    }
}
